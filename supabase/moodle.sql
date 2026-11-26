-- Moodle calendar link: encrypted at rest in Supabase Vault, reachable only by its owner.
-- Paste this whole file into Supabase → SQL Editor → New query → Run. Safe to run more than once.
-- Also upgrades the first version (a plain `url` column): an existing link is moved into Vault and the column dropped.
--
-- Where things live:
--   vault.secrets          the link itself, encrypted (Vault). No access for anon/authenticated at all.
--   public.moodle_feeds    one row per user: which Vault secret, the host name, when it was saved. No link in it.
-- Access only through these functions (all check auth.uid(); nobody can name another user):
--   moodle_feed_set(url)   save / replace your link (checked to be a Technion Moodle calendar export address)
--   moodle_feed_get()      your link, decrypted — used by the Edge Function with your own token; the site never calls it
--   moodle_feed_delete()   delete your link (row + Vault secret)
--   moodle_claim_fetch()   rate limit for the Edge Function
-- No service_role key is used anywhere.

create extension if not exists supabase_vault with schema vault;

-- 1) The table (no secret in it)
create table if not exists public.moodle_feeds (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  secret_id  uuid,
  host       text,
  updated_at timestamptz not null default now()
);
alter table public.moodle_feeds add column if not exists secret_id uuid;

-- 1a) Upgrade from the first version: move each plain link into Vault, then drop the plain column.
do $$
declare
  r record;
  sid uuid;
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'moodle_feeds' and column_name = 'url') then
    for r in execute 'select user_id, url from public.moodle_feeds where secret_id is null and url is not null' loop
      sid := null;
      select id into sid from vault.secrets where name = 'moodle_feed:' || r.user_id;
      if sid is null then
        sid := vault.create_secret(r.url, 'moodle_feed:' || r.user_id, 'Moodle calendar link (course-tracker)');
      else
        perform vault.update_secret(sid, r.url);
      end if;
      update public.moodle_feeds set secret_id = sid where user_id = r.user_id;
    end loop;
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'moodle_feeds' and column_name = 'host' and is_generated = 'ALWAYS') then
      execute 'alter table public.moodle_feeds alter column host drop expression';
    end if;
    execute 'alter table public.moodle_feeds drop column url';
  end if;
end;
$$;

alter table public.moodle_feeds enable row level security;

drop policy if exists "read own feed"   on public.moodle_feeds;
drop policy if exists "insert own feed" on public.moodle_feeds;
drop policy if exists "update own feed" on public.moodle_feeds;
drop policy if exists "delete own feed" on public.moodle_feeds;

-- reading your own row (host, date) is allowed; every write goes through the functions below
create policy "read own feed" on public.moodle_feeds for select to authenticated using (auth.uid() = user_id);
revoke all on public.moodle_feeds from anon, authenticated;
grant select on public.moodle_feeds to authenticated;

-- 1b) Deleting the row (yourself, or with the account) also deletes the Vault secret
create or replace function public.moodle_feeds_drop_secret()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.secret_id is not null then
    delete from vault.secrets where id = old.secret_id;
  end if;
  return old;
end;
$$;
revoke all on function public.moodle_feeds_drop_secret() from public, anon, authenticated;
drop trigger if exists moodle_feeds_drop_secret on public.moodle_feeds;
create trigger moodle_feeds_drop_secret after delete on public.moodle_feeds
  for each row execute function public.moodle_feeds_drop_secret();

-- 2) Save / replace. Same address rule as the site and the Edge Function.
create or replace function public.moodle_feed_set(p_url text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  sid uuid;
  h   text;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_url is null or length(p_url) > 600
     or p_url !~ '^https://moodle[0-9]{0,2}\.technion\.ac\.il/calendar/export_execute\.php\?[^#[:space:]]+$' then
    raise exception 'not a Technion Moodle calendar export link' using errcode = '23514';
  end if;
  h := substring(p_url from '^https://([^/]+)/');
  select f.secret_id into sid from public.moodle_feeds f where f.user_id = uid for update;
  if sid is null or not exists (select 1 from vault.secrets s where s.id = sid) then
    sid := null;
    select s.id into sid from vault.secrets s where s.name = 'moodle_feed:' || uid;
  end if;
  if sid is null then
    sid := vault.create_secret(p_url, 'moodle_feed:' || uid, 'Moodle calendar link (course-tracker)');
  else
    perform vault.update_secret(sid, p_url);
  end if;
  insert into public.moodle_feeds (user_id, secret_id, host, updated_at) values (uid, sid, h, now())
    on conflict (user_id) do update set secret_id = excluded.secret_id, host = excluded.host, updated_at = now();
  return h;
end;
$$;

-- 3) Read (decrypted). Only the caller's own row.
create or replace function public.moodle_feed_get()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v   text;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select d.decrypted_secret into v
    from public.moodle_feeds f join vault.decrypted_secrets d on d.id = f.secret_id
   where f.user_id = uid;
  return v;
end;
$$;

-- 4) Delete (the trigger removes the Vault secret)
create or replace function public.moodle_feed_delete()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  delete from public.moodle_feeds where user_id = uid;
  return found;
end;
$$;

revoke all on function public.moodle_feed_set(text) from public, anon;
revoke all on function public.moodle_feed_get()     from public, anon;
revoke all on function public.moodle_feed_delete()  from public, anon;
grant execute on function public.moodle_feed_set(text) to authenticated;
grant execute on function public.moodle_feed_get()     to authenticated;
grant execute on function public.moodle_feed_delete()  to authenticated;

-- 5) Rate limit for the Edge Function: at most one Moodle fetch per user every 5 minutes.
--    Nobody can read or change this table directly; only the function below touches it.
create table if not exists public.moodle_fetch_log (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  last_fetch_at timestamptz not null
);
alter table public.moodle_fetch_log enable row level security; -- no policies = no direct access
revoke all on public.moodle_fetch_log from anon, authenticated;

-- Returns 0 and records the fetch when allowed; otherwise the seconds left to wait.
create or replace function public.moodle_claim_fetch()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  uid  uuid := auth.uid();
  last timestamptz;
  gap  constant interval := interval '5 minutes';
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select last_fetch_at into last from public.moodle_fetch_log where user_id = uid for update;
  if last is not null and now() - last < gap then
    return ceil(extract(epoch from (gap - (now() - last))))::integer;
  end if;
  insert into public.moodle_fetch_log (user_id, last_fetch_at) values (uid, now())
    on conflict (user_id) do update set last_fetch_at = excluded.last_fetch_at;
  return 0;
end;
$$;

revoke all on function public.moodle_claim_fetch() from public, anon;
grant execute on function public.moodle_claim_fetch() to authenticated;

-- Check after running (host and date only, never a link):
--   select * from public.moodle_feeds;
