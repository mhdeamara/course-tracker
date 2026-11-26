-- AI assistant: usage tracking and limits for the Edge Function "ai".
-- Paste this whole file into Supabase → SQL Editor → New query → Run. Safe to run more than once.
--
-- Who can do what:
--   * You (signed in) can READ your own usage rows, to show "used today" in Settings. Nothing else.
--   * Only the Edge Function can WRITE, through the two functions below, which only the service role may run.
--     So even someone holding your login token cannot reset the counters or raise the limits.
-- Days are counted in Israel time.

create table if not exists public.ai_usage (
  user_id       uuid    not null references auth.users (id) on delete cascade,
  day           date    not null,
  requests      integer not null default 0,
  extracts      integer not null default 0,
  input_tokens  bigint  not null default 0,
  output_tokens bigint  not null default 0,
  cost_usd      numeric(12, 6) not null default 0,
  primary key (user_id, day)
);

alter table public.ai_usage enable row level security;
drop policy if exists "read own ai usage" on public.ai_usage;
create policy "read own ai usage" on public.ai_usage for select to authenticated using (auth.uid() = user_id);
revoke all on public.ai_usage from anon;
revoke insert, update, delete on public.ai_usage from authenticated;
grant select on public.ai_usage to authenticated;

-- Requests in the current minute (per-minute limit). No access for anyone but the functions below.
create table if not exists public.ai_minute (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  window_start timestamptz not null,
  count        integer not null
);
alter table public.ai_minute enable row level security;
revoke all on public.ai_minute from anon, authenticated;

-- Before a request: check the limits and count it. Returns {"ok":true} or {"ok":false,"reason":...,"retry_after":seconds}.
create or replace function public.ai_begin(
  p_user uuid, p_kind text, p_per_minute integer, p_daily_cost numeric, p_daily_extracts integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'Asia/Jerusalem')::date;
  u     public.ai_usage%rowtype;
  m     public.ai_minute%rowtype;
begin
  insert into public.ai_usage (user_id, day) values (p_user, today) on conflict do nothing;
  select * into u from public.ai_usage where user_id = p_user and day = today for update;
  if u.cost_usd >= p_daily_cost then
    return jsonb_build_object('ok', false, 'reason', 'daily-cost');
  end if;
  if p_kind = 'extract' and u.extracts >= p_daily_extracts then
    return jsonb_build_object('ok', false, 'reason', 'daily-extracts');
  end if;

  select * into m from public.ai_minute where user_id = p_user for update;
  if found and now() - m.window_start < interval '1 minute' then
    if m.count >= p_per_minute then
      return jsonb_build_object('ok', false, 'reason', 'per-minute',
        'retry_after', ceil(extract(epoch from (interval '1 minute' - (now() - m.window_start))))::integer);
    end if;
    update public.ai_minute set count = count + 1 where user_id = p_user;
  else
    insert into public.ai_minute (user_id, window_start, count) values (p_user, now(), 1)
      on conflict (user_id) do update set window_start = excluded.window_start, count = 1;
  end if;

  update public.ai_usage
     set requests = requests + 1,
         extracts = extracts + case when p_kind = 'extract' then 1 else 0 end
   where user_id = p_user and day = today;
  return jsonb_build_object('ok', true);
end;
$$;

-- After a request: add the tokens and the cost.
create or replace function public.ai_finish(
  p_user uuid, p_input bigint, p_output bigint, p_cost numeric
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'Asia/Jerusalem')::date;
begin
  insert into public.ai_usage (user_id, day, input_tokens, output_tokens, cost_usd)
       values (p_user, today, greatest(p_input, 0), greatest(p_output, 0), greatest(p_cost, 0))
  on conflict (user_id, day) do update
     set input_tokens  = public.ai_usage.input_tokens  + excluded.input_tokens,
         output_tokens = public.ai_usage.output_tokens + excluded.output_tokens,
         cost_usd      = public.ai_usage.cost_usd      + excluded.cost_usd;
end;
$$;

revoke all on function public.ai_begin(uuid, text, integer, numeric, integer) from public, anon, authenticated;
revoke all on function public.ai_finish(uuid, bigint, bigint, numeric)        from public, anon, authenticated;
grant execute on function public.ai_begin(uuid, text, integer, numeric, integer) to service_role;
grant execute on function public.ai_finish(uuid, bigint, bigint, numeric)        to service_role;
