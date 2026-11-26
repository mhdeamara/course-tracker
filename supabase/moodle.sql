-- Moodle calendar link: stored only here, readable and writable only by its owner.
-- Paste this whole file into Supabase → SQL Editor → New query → Run. Safe to run more than once.
-- Run supabase/schema.sql first (it is independent, but that is the usual order).

-- 1) The secret link. One row per user. The link is checked to be a Technion Moodle calendar export address.
create table if not exists public.moodle_feeds (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  url        text        not null
             check (url ~ '^https://moodle[0-9]{0,2}\.technion\.ac\.il/calendar/export_execute\.php\?[^#[:space:]]+$'
                    and length(url) <= 600),
  -- the host only, so the app can show "connected to moodle26.technion.ac.il" without ever reading the link back
  host       text generated always as (substring(url from '^https://([^/]+)/')) stored,
  updated_at timestamptz not null default now()
);

alter table public.moodle_feeds enable row level security;

drop policy if exists "read own feed"   on public.moodle_feeds;
drop policy if exists "insert own feed" on public.moodle_feeds;
drop policy if exists "update own feed" on public.moodle_feeds;
drop policy if exists "delete own feed" on public.moodle_feeds;

create policy "read own feed"   on public.moodle_feeds for select to authenticated using (auth.uid() = user_id);
create policy "insert own feed" on public.moodle_feeds for insert to authenticated with check (auth.uid() = user_id);
create policy "update own feed" on public.moodle_feeds for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own feed" on public.moodle_feeds for delete to authenticated using (auth.uid() = user_id);

revoke all on public.moodle_feeds from anon;
grant select, insert, update, delete on public.moodle_feeds to authenticated;

-- 2) Rate limit for the Edge Function: at most one Moodle fetch per user every 5 minutes.
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
