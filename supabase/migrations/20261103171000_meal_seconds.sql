-- SPEC §8 step 10, §11 Checkpoints (v0.12, owner's request): a meal can be put in seconds mode, so a hacker who was
-- already served there taps in again and gets ACCEPTED (`seconds: true`) instead of ALREADY_SCANNED. Nothing new is
-- written: the first serving stays the one live scan (scans_one_live is unchanged), so meal counts still count people.
-- Every other step of record_scan() is unchanged (copied from 20261103161000_workshop_cooldown); only the two
-- ALREADY_SCANNED answers (step 10 and the re-read after a racing insert) check seconds mode first, and a retry of this
-- same scan still answers as a replay before either.
alter table checkpoints add column seconds_mode boolean not null default false;
alter table checkpoints add constraint checkpoints_seconds_meal check (kind = 'meal' or not seconds_mode);

CREATE OR REPLACE FUNCTION public.record_scan(p_checkpoint_id uuid, p_staff_user_id uuid, p_method scan_method, p_token_hash text, p_participant_id uuid, p_client_scan_id uuid, p_client_scanned_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  cp checkpoints%rowtype; pa participants%rowtype; ps passes%rowtype; prior scans%rowtype;
  live_n int; new_id uuid; who jsonb; cooldown int; last_session timestamptz;
begin
  -- 1. replay
  select * into prior from scans where client_scan_id = p_client_scan_id;
  if found then
    if prior.scanned_by <> p_staff_user_id then
      return jsonb_build_object('code','CLIENT_ID_CONFLICT');
    end if;
    select * into cp from checkpoints  where id = prior.checkpoint_id;
    select * into pa from participants where id = prior.participant_id;
    return jsonb_build_object('code','ACCEPTED','replayed',true,'scanId',prior.id,
      'voided', prior.voided_at is not null, 'participant', _who(pa, cp.kind));
  end if;

  -- 2-3. checkpoint + authz
  select * into cp from checkpoints where id = p_checkpoint_id;
  if not found then return jsonb_build_object('code','CHECKPOINT_NOT_FOUND'); end if;
  if not exists (select 1 from event_staff where event_id = cp.event_id and user_id = p_staff_user_id) then
    return jsonb_build_object('code','FORBIDDEN');
  end if;

  -- 4. resolve
  if p_method = 'qr' then
    select * into ps from passes where token_hash = p_token_hash;
    if not found then return jsonb_build_object('code','NOT_FOUND'); end if;
    select * into pa from participants where id = ps.participant_id;
  else
    select * into pa from participants where id = p_participant_id and deleted_at is null;
    if not found then return jsonb_build_object('code','NOT_FOUND'); end if;
  end if;
  who := _who(pa, cp.kind);

  -- 5. revoked
  if p_method = 'qr' and ps.revoked_at is not null then
    return jsonb_build_object('code','REVOKED','participant',who,'revokeReason',ps.revoke_reason,
      'reissued', exists (select 1 from passes where participant_id = pa.id and revoked_at is null));
  end if;

  -- 6-8. event, status, open
  if pa.event_id <> cp.event_id then
    return jsonb_build_object('code','WRONG_EVENT','otherEvent',(select name from events where id = pa.event_id));
  end if;
  if pa.status <> 'accepted' then return jsonb_build_object('code','NOT_ACCEPTED','participant',who); end if;
  if not cp.is_open then return jsonb_build_object('code','CHECKPOINT_CLOSED','participant',who); end if;

  -- 9a. (proposed, workshop cooldown) serialize this person's workshop scans: two taps at two workshops at
  -- the same moment must see each other (T-CONC-09). Always taken before the step-9 checkpoint lock, so the
  -- lock order is the same for every scan (no deadlock). Only session checkpoints, only when a cooldown is set.
  select session_cooldown_minutes into cooldown from events where id = cp.event_id;
  if cp.kind = 'session' and cooldown > 0 then
    perform pg_advisory_xact_lock(hashtextextended('session_cooldown:' || pa.id::text, 0));
  end if;

  -- 9. serialize capacity-limited checkpoints
  if cp.capacity is not null then
    perform 1 from checkpoints where id = cp.id for update;
  end if;

  -- 10. already scanned (a concurrent retry of THIS scan may have committed after step 1)
  select * into prior from scans where participant_id = pa.id and checkpoint_id = cp.id and voided_at is null;
  if found then
    if prior.client_scan_id = p_client_scan_id then
      return jsonb_build_object('code','ACCEPTED','replayed',true,'scanId',prior.id,'participant',who);
    end if;
    if cp.seconds_mode then  -- v0.12: seconds at a meal; the first serving stays the only row
      return jsonb_build_object('code','ACCEPTED','replayed',false,'seconds',true,'scanId',prior.id,'participant',who);
    end if;
    return jsonb_build_object('code','ALREADY_SCANNED','participant',who,'previous',_prior(prior, p_staff_user_id));
  end if;

  -- 11. door prerequisite
  if cp.requires_checkin and not exists (
      select 1 from scans s join checkpoints d on d.id = s.checkpoint_id
       where s.participant_id = pa.id and d.kind = 'door' and s.voided_at is null) then
    return jsonb_build_object('code','NOT_CHECKED_IN','participant',who);
  end if;

  -- 11b. (proposed) workshop cooldown: no other live workshop scan in the last `cooldown` minutes. After step 10,
  -- so a repeat at the same workshop still answers ALREADY_SCANNED; voided scans don't count (I-9).
  if cp.kind = 'session' and cooldown > 0 then
    select max(s.scanned_at) into last_session
      from scans s join checkpoints c on c.id = s.checkpoint_id
     where s.participant_id = pa.id and c.kind = 'session' and s.checkpoint_id <> cp.id and s.voided_at is null;
    if last_session is not null and last_session + make_interval(mins => cooldown) > now() then
      return jsonb_build_object('code','SESSION_COOLDOWN','participant',who,
        'availableAt', last_session + make_interval(mins => cooldown), 'cooldownMinutes', cooldown);
    end if;
  end if;

  -- 12. capacity
  if cp.capacity is not null then
    select count(*) into live_n from scans where checkpoint_id = cp.id and voided_at is null;
    if live_n >= cp.capacity then
      return jsonb_build_object('code','CAPACITY_REACHED','participant',who,'capacity',cp.capacity);
    end if;
  end if;

  -- 13. insert
  begin
    insert into scans (event_id, participant_id, checkpoint_id, pass_id, method,
                       scanned_by, client_scan_id, client_scanned_at)
    values (cp.event_id, pa.id, cp.id, case when p_method = 'qr' then ps.id end, p_method,
            p_staff_user_id, p_client_scan_id, p_client_scanned_at)
    on conflict (participant_id, checkpoint_id) where voided_at is null do nothing
    returning id into new_id;
  exception when unique_violation then
    -- client_scan_id collided (a concurrent retry of this same scan won the race)
    select * into prior from scans where client_scan_id = p_client_scan_id;
    if found and prior.scanned_by = p_staff_user_id then
      return jsonb_build_object('code','ACCEPTED','replayed',true,'scanId',prior.id,'participant',who);
    end if;
    return jsonb_build_object('code','CLIENT_ID_CONFLICT');
  end;

  if new_id is null then
    select * into prior from scans where participant_id = pa.id and checkpoint_id = cp.id and voided_at is null;
    if prior.client_scan_id = p_client_scan_id then
      return jsonb_build_object('code','ACCEPTED','replayed',true,'scanId',prior.id,'participant',who);
    end if;
    if cp.seconds_mode then  -- v0.12: seconds at a meal; the first serving stays the only row
      return jsonb_build_object('code','ACCEPTED','replayed',false,'seconds',true,'scanId',prior.id,'participant',who);
    end if;
    return jsonb_build_object('code','ALREADY_SCANNED','participant',who,'previous',_prior(prior, p_staff_user_id));
  end if;

  return jsonb_build_object('code','ACCEPTED','replayed',false,'scanId',new_id,'participant',who);
end $function$;
revoke all on function public.record_scan(uuid,uuid,scan_method,text,uuid,uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.record_scan(uuid,uuid,scan_method,text,uuid,uuid,timestamptz) to service_role;
