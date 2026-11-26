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
--   moodle_snapshots       the last calendar fetched for you (by the schedule or by "רענן עכשיו") — owner-only read
--   pg_cron job            every 2 hours calls the Edge Function, which refreshes every saved link (section 7)
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
-- what the link asks Moodle for (not secret): preset_what (all / courses …) and preset_time (custom / recentupcoming …)
alter table public.moodle_feeds add column if not exists what   text;
alter table public.moodle_feeds add column if not exists preset text;

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
  insert into public.moodle_feeds (user_id, secret_id, host, what, preset, updated_at)
    values (uid, sid, h, substring(p_url from '[?&]preset_what=([a-z]+)'), substring(p_url from '[?&]preset_time=([a-z]+)'), now())
    on conflict (user_id) do update set secret_id = excluded.secret_id, host = excluded.host,
      what = excluded.what, preset = excluded.preset, updated_at = now();
  -- a new link: the old calendar no longer applies
  delete from public.moodle_snapshots where user_id = uid;
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
  delete from public.moodle_snapshots where user_id = uid;
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

-- 6) The last calendar fetched for you. No link in it — only the calendar text (assignment names and dates),
--    readable only by you. Written only through the functions below.
create table if not exists public.moodle_snapshots (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  ics        text,            -- the calendar (iCalendar text), last successful fetch
  hash       text,            -- SHA-256 of ics, so the site knows when something changed
  events     integer,
  fetched_at timestamptz,     -- last successful fetch
  changed_at timestamptz,     -- when the calendar last changed
  checked_at timestamptz,     -- last attempt (successful or not)
  error      text,            -- error code of the last attempt; null when it worked
  source     text             -- 'cron' or 'manual'
);
alter table public.moodle_snapshots enable row level security;
drop policy if exists "read own snapshot" on public.moodle_snapshots;
create policy "read own snapshot" on public.moodle_snapshots for select to authenticated using (auth.uid() = user_id);
revoke all on public.moodle_snapshots from anon, authenticated;
grant select on public.moodle_snapshots to authenticated;

-- internal: store one fetch result (not callable from outside)
create or replace function public.moodle__save_snapshot(p_user uuid, p_ics text, p_hash text, p_events integer, p_error text, p_source text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_error is null and (p_ics is null or length(p_ics) > 2 * 1024 * 1024 or p_ics !~ '^BEGIN:VCALENDAR' or p_hash !~ '^[0-9a-f]{64}$') then
    raise exception 'bad snapshot' using errcode = '22023';
  end if;
  if p_error is not null and p_error !~ '^[a-z-]{1,40}$' then
    raise exception 'bad error code' using errcode = '22023';
  end if;
  insert into public.moodle_snapshots as m (user_id, ics, hash, events, fetched_at, changed_at, checked_at, error, source)
    values (p_user, p_ics, p_hash, p_events, case when p_error is null then now() end, case when p_error is null then now() end, now(), p_error, p_source)
  on conflict (user_id) do update set
    ics        = coalesce(excluded.ics, m.ics),
    hash       = coalesce(excluded.hash, m.hash),
    events     = coalesce(excluded.events, m.events),
    fetched_at = coalesce(excluded.fetched_at, m.fetched_at),
    changed_at = case when excluded.hash is not null and excluded.hash is distinct from m.hash then now() else m.changed_at end,
    checked_at = now(),
    error      = excluded.error,
    source     = excluded.source;
end;
$$;
revoke all on function public.moodle__save_snapshot(uuid, text, text, integer, text, text) from public, anon, authenticated;

-- "רענן עכשיו": the Edge Function stores what it fetched for the signed-in user
create or replace function public.moodle_snapshot_save(p_ics text, p_hash text, p_events integer, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  perform public.moodle__save_snapshot(auth.uid(), p_ics, p_hash, p_events, p_error, 'manual');
end;
$$;
revoke all on function public.moodle_snapshot_save(text, text, integer, text) from public, anon;
grant execute on function public.moodle_snapshot_save(text, text, integer, text) to authenticated;

-- 7) Scheduled refresh (every 2 hours). The schedule calls the Edge Function with a random secret kept in Vault;
--    the function uses it to ask for the links that are due and to store the results. The secret is never in code,
--    in git or in the job text (the job reads it from Vault each time).
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'moodle_cron_secret') then
    perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
                                'moodle_cron_secret', 'course-tracker: lets the scheduled job call moodle-ical');
  end if;
end;
$$;

create or replace function public.moodle__cron_ok(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_secret is not null and length(p_secret) >= 32
     and exists (select 1 from vault.decrypted_secrets where name = 'moodle_cron_secret' and decrypted_secret = p_secret);
$$;
revoke all on function public.moodle__cron_ok(text) from public, anon, authenticated;

-- the links that are due (not checked in the last 100 minutes), at most 25 per run
create or replace function public.moodle_cron_feeds(p_secret text)
returns table (user_id uuid, url text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.moodle__cron_ok(p_secret) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select f.user_id, d.decrypted_secret::text
      from public.moodle_feeds f
      join vault.decrypted_secrets d on d.id = f.secret_id
      left join public.moodle_snapshots m on m.user_id = f.user_id
     where m.checked_at is null or m.checked_at < now() - interval '100 minutes'
     order by m.checked_at nulls first
     limit 25;
end;
$$;

create or replace function public.moodle_cron_save(p_secret text, p_user uuid, p_ics text, p_hash text, p_events integer, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.moodle__cron_ok(p_secret) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.moodle_feeds where user_id = p_user) then
    return; -- disconnected meanwhile
  end if;
  perform public.moodle__save_snapshot(p_user, p_ics, p_hash, p_events, p_error, 'cron');
end;
$$;
-- The Edge Function calls these two without a user (publishable key only); the Vault secret is the gate.
revoke all on function public.moodle_cron_feeds(text) from public, authenticated;
revoke all on function public.moodle_cron_save(text, uuid, text, text, integer, text) from public, authenticated;
grant execute on function public.moodle_cron_feeds(text) to anon;
grant execute on function public.moodle_cron_save(text, uuid, text, text, integer, text) to anon;

-- 7a) Links saved before this version: fill in what they ask for (preset), without exposing them
update public.moodle_feeds f
   set what   = substring(d.decrypted_secret from '[?&]preset_what=([a-z]+)'),
       preset = substring(d.decrypted_secret from '[?&]preset_time=([a-z]+)')
  from vault.decrypted_secrets d
 where d.id = f.secret_id and f.preset is null;

-- 8) The schedule: minute 17 of every second hour. Needs the pg_cron and pg_net extensions.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'moodle-ical-refresh') then
    perform cron.unschedule('moodle-ical-refresh');
  end if;
end;
$$;

select cron.schedule('moodle-ical-refresh', '17 */2 * * *', $job$
  select net.http_post(
    url     := 'https://xugwweikrcievcqfmfgc.supabase.co/functions/v1/moodle-ical',
    headers := jsonb_build_object('Content-Type', 'application/json',
                 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'moodle_cron_secret')),
    body    := '{"mode":"cron"}'::jsonb,
    timeout_milliseconds := 120000
  );
$job$);

-- Check after running:
--   select * from public.moodle_feeds;                    -- host, date, preset — never a link
--   select jobname, schedule from cron.job;               -- moodle-ical-refresh | 17 */2 * * *
--   select user_id, events, fetched_at, checked_at, error from public.moodle_snapshots;  -- after the first run
