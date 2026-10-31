-- L4: atomic scan rate gate (SPEC §15). The handler counted scan_attempts and inserted after
-- record_scan(), so a concurrent burst could exceed the per-minute ceiling (check-then-act race).
-- scan_rate_reserve() counts both windows and reserves the attempt under a per-user advisory lock in
-- one transaction; the caller completes the reserved row (never a second insert), so audit logging
-- still lands exactly once per gated attempt and NOT_FOUND rows keep feeding the 5-minute budget.
-- The scan outcome itself still comes from record_scan() (I-2: unchanged).
create or replace function public.scan_rate_reserve(
  p_staff_user_id uuid,
  p_per_minute_limit int,
  p_not_found_limit int
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_total int;
  v_not_found int;
  v_reservation_id bigint;
begin
  -- Serialize concurrent scans from one staffer (arbitrary namespace key; no other advisory locks
  -- exist in this schema). xact-scoped: released at commit, so a stuck request can't jam the user.
  perform pg_advisory_xact_lock(81097531, hashtext(p_staff_user_id::text));
  select count(*) into v_total from scan_attempts
   where staff_user_id = p_staff_user_id and created_at >= now() - interval '60 seconds';
  select count(*) into v_not_found from scan_attempts
   where staff_user_id = p_staff_user_id and result_code = 'NOT_FOUND'
     and created_at >= now() - interval '300 seconds';
  if v_total >= p_per_minute_limit or v_not_found >= p_not_found_limit then
    return jsonb_build_object('allowed', false, 'reservation_id', null);
  end if;
  -- The reservation holds budget against concurrent bursts; the caller updates it with the real
  -- result code, so it only lingers when a request dies mid-flight (then it ages out of the 60 s
  -- window, and event_id stays null meanwhile so event_metrics ignores it).
  insert into scan_attempts (staff_user_id, result_code) values (p_staff_user_id, 'RESERVED')
  returning id into v_reservation_id;
  return jsonb_build_object('allowed', true, 'reservation_id', v_reservation_id);
end $$;
revoke all on function public.scan_rate_reserve(uuid, int, int) from public, anon, authenticated;
grant execute on function public.scan_rate_reserve(uuid, int, int) to service_role;
