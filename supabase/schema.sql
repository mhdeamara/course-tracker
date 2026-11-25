-- Course tracker: cloud storage for sync between devices.
-- Paste this whole file into Supabase → SQL Editor → New query → Run. Safe to run more than once.
--
-- One row per user holds the whole app state as JSON.
-- `version` lets the app detect when two devices edited at the same time.

create table if not exists public.user_data (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data       jsonb       not null,
  version    bigint      not null default 1,
  updated_at timestamptz not null default now()
);

-- Row Level Security: every signed-in user can only see and change their own row.
alter table public.user_data enable row level security;

drop policy if exists "read own data"   on public.user_data;
drop policy if exists "insert own data" on public.user_data;
drop policy if exists "update own data" on public.user_data;
drop policy if exists "delete own data" on public.user_data;

create policy "read own data"   on public.user_data for select to authenticated using (auth.uid() = user_id);
create policy "insert own data" on public.user_data for insert to authenticated with check (auth.uid() = user_id);
create policy "update own data" on public.user_data for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own data" on public.user_data for delete to authenticated using (auth.uid() = user_id);

-- No access at all for visitors who are not signed in.
revoke all on public.user_data from anon;
grant select, insert, update, delete on public.user_data to authenticated;
