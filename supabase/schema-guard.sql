-- Course tracker: server-side schema guard for public.user_data.
-- Stops an app version from saving over data that was saved by a NEWER app version (which it cannot read fully),
-- including the case where an old app "normalizes" newer data but keeps data.version unchanged.
--
-- The rule compares the WRITER's supported schema version with the version ALREADY STORED in the row — never only
-- the version inside the new payload. The writer's version comes from public.ct_save(p_writer); a write that does not
-- go through ct_save (a direct PATCH/POST from an app built before this file existed) counts as writer version 4,
-- which is exactly what every such app supports.
--
-- PART 1 (install): run it in Supabase → SQL Editor. Safe to run more than once. Existing rows are all version 4,
-- so nothing changes for current app versions.
-- PART 2 (tests): run it SEPARATELY, after part 1. It works inside one DO block that always ends with an exception,
-- so every test row is rolled back. Expected result: an error whose message starts with CT_GUARD_TESTS_PASSED.
-- This is a guard against mistakes (old tabs, stale caches), not against a hostile client: a client can claim any
-- p_writer, but only for its own row — Row Level Security is unchanged.

-- ============================== PART 1: install ==============================

-- Schema version of a stored state: 1..999 (a number, or a string of digits), 1 when missing (first app version),
-- -1 when malformed (not an object, null, negative, fractional, out of range, any other type).
create or replace function public.ct_schema_of(d jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when d is null or jsonb_typeof(d) <> 'object' then -1
    when not (d ? 'version') then 1
    when jsonb_typeof(d -> 'version') in ('number', 'string') and (d ->> 'version') ~ '^[1-9][0-9]{0,2}$'
      then (d ->> 'version')::integer
    else -1
  end
$$;

-- Trigger: runs for every insert/update of user_data, whatever the path (ct_save, a legacy PATCH, the SQL editor).
create or replace function public.ct_user_data_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  raw text := current_setting('ct.writer_schema', true);
  w integer;                                   -- the writer's supported schema version
  n integer := public.ct_schema_of(new.data);  -- version inside the new payload
  o integer;                                   -- version already stored
begin
  if raw is null or raw = '' then
    w := 4;                                    -- legacy baseline: apps without ct_save support schema 4
  elsif raw ~ '^[1-9][0-9]{0,2}$' then
    w := raw::integer;
  else
    raise exception 'ct_schema_bad_writer' using errcode = 'P0001';
  end if;

  if tg_op = 'UPDATE' then
    o := public.ct_schema_of(old.data);
    if o < 0 then
      raise exception 'ct_schema_malformed_stored' using errcode = 'P0001',
        detail = 'The stored data has a malformed schema version; it is not overwritten.';
    end if;
    if w < o then
      raise exception 'ct_schema_too_old' using errcode = 'P0001',
        detail = format('writer supports %s, stored data is %s', w, o);
    end if;
  end if;

  if n < 0 then
    raise exception 'ct_schema_malformed' using errcode = 'P0001';
  end if;
  if n > w then
    raise exception 'ct_schema_writer_mismatch' using errcode = 'P0001',
      detail = format('payload is %s, writer supports %s', n, w);
  end if;
  if tg_op = 'UPDATE' and n < o then
    raise exception 'ct_schema_downgrade' using errcode = 'P0001',
      detail = format('payload is %s, stored data is %s', n, o);
  end if;
  return new;
end
$$;

drop trigger if exists user_data_schema_guard on public.user_data;
create trigger user_data_schema_guard
  before insert or update on public.user_data
  for each row execute function public.ct_user_data_guard();

-- The app's write path. SECURITY INVOKER: runs as the signed-in user, so the existing RLS policies apply.
-- p_expected = null → first save (insert); otherwise an update only if the row still has that version
-- (optimistic locking, one atomic UPDATE). Returns the new row version, or null on a conflict.
create or replace function public.ct_save(p_data jsonb, p_expected bigint, p_writer integer)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v bigint;
begin
  if uid is null then
    raise exception 'ct_auth_required' using errcode = '28000';
  end if;
  if p_writer is null or p_writer < 1 or p_writer > 999 then
    raise exception 'ct_schema_bad_writer' using errcode = 'P0001';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'ct_schema_malformed' using errcode = 'P0001';
  end if;
  if p_expected is not null and p_expected < 1 then
    raise exception 'ct_bad_expected_version' using errcode = 'P0001';
  end if;

  perform set_config('ct.writer_schema', p_writer::text, true);   -- read by the trigger, this transaction only
  if p_expected is null then
    insert into public.user_data (user_id, data, version, updated_at)
    values (uid, p_data, 1, now())
    on conflict (user_id) do nothing
    returning version into v;
  else
    update public.user_data
       set data = p_data, version = version + 1, updated_at = now()
     where user_id = uid and version = p_expected
    returning version into v;
  end if;
  perform set_config('ct.writer_schema', '', true);
  return v;
end
$$;

revoke all on function public.ct_schema_of(jsonb)               from public, anon;
revoke all on function public.ct_user_data_guard()              from public, anon;
revoke all on function public.ct_save(jsonb, bigint, integer)   from public, anon;
grant execute on function public.ct_schema_of(jsonb)             to authenticated, service_role;
grant execute on function public.ct_user_data_guard()            to authenticated, service_role;
grant execute on function public.ct_save(jsonb, bigint, integer) to authenticated;

-- Check after installing:
--   select tgname from pg_trigger where tgrelid = 'public.user_data'::regclass and not tgisinternal;  -- user_data_schema_guard
--   select proname, prosecdef from pg_proc where proname in ('ct_save','ct_schema_of','ct_user_data_guard');  -- prosecdef = false
-- Fixing a row by hand in the SQL editor: run  select set_config('ct.writer_schema', '<version>', true);  in the
-- same transaction first, otherwise the edit counts as a version-4 writer.
-- Undo this file:
--   drop trigger if exists user_data_schema_guard on public.user_data;
--   drop function if exists public.ct_save(jsonb, bigint, integer), public.ct_user_data_guard(), public.ct_schema_of(jsonb);

-- ============================== PART 2: tests (run separately) ==============================
-- Creates two throw-away users and rows, acts as each of them through the "authenticated" role and JWT claims
-- (like PostgREST does), and checks every rule. Ends with an exception on purpose → everything is rolled back.
/*
do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  v bigint;
  ok boolean;
  n integer;
  bad jsonb;
begin
  insert into auth.users (id, aud, role, email)
  values (a, 'authenticated', 'authenticated', 'ct-guard-a-' || a || '@example.invalid'),
         (b, 'authenticated', 'authenticated', 'ct-guard-b-' || b || '@example.invalid');

  -- ct_schema_of
  assert public.ct_schema_of('{"version":4}') = 4, 'schema_of number';
  assert public.ct_schema_of('{"version":"5"}') = 5, 'schema_of digit string';
  assert public.ct_schema_of('{"courses":[]}') = 1, 'schema_of missing = 1';
  foreach bad in array array['{"version":"abc"}','{"version":-1}','{"version":4.5}','{"version":null}',
                             '{"version":1000}','{"version":0}','{"version":[4]}','[1]','"x"']::jsonb[] loop
    assert public.ct_schema_of(bad) = -1, 'schema_of malformed: ' || bad::text;
  end loop;

  -- ===== act as user A =====
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);

  -- T1 RPC insert (v4 writer, v4 data) → version 1
  v := public.ct_save('{"version":4,"courses":[]}', null, 4);
  assert v = 1, 'T1 rpc insert';
  -- T2 second insert → null (row exists: conflict, nothing written)
  assert public.ct_save('{"version":4,"courses":[]}', null, 4) is null, 'T2 duplicate insert is a conflict';
  -- T3 RPC update with the right expected version → 2
  assert public.ct_save('{"version":4,"courses":[1]}', 1, 4) = 2, 'T3 rpc update';
  -- T4 concurrency: a stale expected version changes nothing
  assert public.ct_save('{"version":4,"courses":[2]}', 1, 4) is null, 'T4 stale expected → conflict';
  select version into v from public.user_data where user_id = a;
  assert v = 2, 'T4 row unchanged';
  -- T5 legacy direct write (no ct_save, like the old PATCH) on v4 data still works
  update public.user_data set data = '{"version":4,"courses":[3]}', version = version + 1 where user_id = a and version = 2;
  get diagnostics n = row_count;
  assert n = 1, 'T5 legacy write of v4 data';
  -- T6 a v5 writer upgrades the row to v5
  assert public.ct_save('{"version":5,"courses":[],"newField":1}', 3, 5) = 4, 'T6 v5 writer upgrade';

  -- T7 legacy direct write keeping data.version = 5 (old app normalized newer data) → rejected
  begin
    update public.user_data set data = '{"version":5,"courses":[]}', version = version + 1 where user_id = a;
    ok := false;
  exception when raise_exception then ok := sqlerrm = 'ct_schema_too_old';
  end;
  assert ok, 'T7 same-version normalization by legacy writer rejected';
  -- T8 legacy direct write with v4 payload over v5 → rejected
  begin
    update public.user_data set data = '{"version":4,"courses":[]}', version = version + 1 where user_id = a;
    ok := false;
  exception when raise_exception then ok := sqlerrm = 'ct_schema_too_old';
  end;
  assert ok, 'T8 legacy downgrade rejected';
  -- T9 RPC from a v4 app over v5 → rejected
  begin
    perform public.ct_save('{"version":5,"courses":[]}', 4, 4);
    ok := false;
  exception when raise_exception then ok := sqlerrm = 'ct_schema_too_old';
  end;
  assert ok, 'T9 rpc v4 writer over v5 rejected';
  -- T10 RPC from a v5 app sending v4 data → downgrade rejected
  begin
    perform public.ct_save('{"version":4,"courses":[]}', 4, 5);
    ok := false;
  exception when raise_exception then ok := sqlerrm = 'ct_schema_downgrade';
  end;
  assert ok, 'T10 downgrade rejected';
  -- T11 malformed payload versions rejected (row stays v5)
  foreach bad in array array['{"version":"abc"}','{"version":-1}','{"version":4.5}','{"version":null}','{"version":1000}']::jsonb[] loop
    begin
      perform public.ct_save(bad, 4, 5);
      ok := false;
    exception when raise_exception then ok := sqlerrm = 'ct_schema_malformed';
    end;
    assert ok, 'T11 malformed payload rejected: ' || bad::text;
  end loop;
  -- T12 bad writer values rejected
  foreach n in array array[0, 1000, -3] loop
    begin
      perform public.ct_save('{"version":5}', 4, n);
      ok := false;
    exception when raise_exception then ok := sqlerrm = 'ct_schema_bad_writer';
    end;
    assert ok, 'T12 bad writer rejected: ' || n;
  end loop;
  begin
    perform public.ct_save('{"version":5}', 4, null);
    ok := false;
  exception when raise_exception then ok := sqlerrm = 'ct_schema_bad_writer';
  end;
  assert ok, 'T12 null writer rejected';
  -- T13 every rejection left the row as it was
  select version into v from public.user_data where user_id = a;
  assert v = 4, 'T13 row version unchanged after rejections';
  assert (select data from public.user_data where user_id = a) = '{"version":5,"courses":[],"newField":1}'::jsonb, 'T13 data unchanged';

  -- ===== act as user B: isolation =====
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  -- T14 B cannot see or change A's row
  assert (select count(*) from public.user_data where user_id = a) = 0, 'T14 B cannot read A';
  update public.user_data set data = '{"version":4}' where user_id = a;
  get diagnostics n = row_count;
  assert n = 0, 'T14 B cannot update A (direct)';
  -- ct_save with A's version only ever targets B's own row (B has none yet) → null, A untouched
  assert public.ct_save('{"version":5,"courses":[]}', 4, 5) is null, 'T14 B rpc cannot target A';
  -- T15 B's first save creates B's row only
  assert public.ct_save('{"version":4,"courses":[]}', null, 4) = 1, 'T15 B insert';
  -- T16 B: payload newer than the writer → rejected
  begin
    perform public.ct_save('{"version":5}', 1, 4);
    ok := false;
  exception when raise_exception then ok := sqlerrm in ('ct_schema_writer_mismatch');
  end;
  assert ok, 'T16 payload newer than writer rejected';

  -- T17 no user in the JWT → rejected
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  begin
    perform public.ct_save('{"version":4}', null, 4);
    ok := false;
  exception when invalid_authorization_specification then ok := sqlerrm = 'ct_auth_required';
  end;
  assert ok, 'T17 auth required';

  -- T18 anon cannot call ct_save at all
  reset role;
  set local role anon;
  begin
    perform public.ct_save('{"version":4}', null, 4);
    ok := false;
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, 'T18 anon has no execute';

  -- T19 a malformed STORED row is never overwritten (set one up with the trigger off, as the table owner)
  reset role;
  alter table public.user_data disable trigger user_data_schema_guard;
  update public.user_data set data = '{"version":"oops"}' where user_id = b;
  alter table public.user_data enable trigger user_data_schema_guard;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  begin
    perform public.ct_save('{"version":5}', 1, 5);
    ok := false;
  exception when raise_exception then ok := sqlerrm = 'ct_schema_malformed_stored';
  end;
  assert ok, 'T19 malformed stored row protected';

  reset role;
  raise exception 'CT_GUARD_TESTS_PASSED (19 groups; all test rows rolled back)';
end
$$;
*/
