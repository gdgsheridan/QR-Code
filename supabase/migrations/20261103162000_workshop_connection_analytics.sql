-- Proposed §13 additions (owner's request 2026-11-02): organizer analytics for workshops (session checkpoints) and
-- the connection game. Like every §13 metric they exclude voided scans, is_test and deleted participants. Buckets
-- are UTC date_bin from the event's starts_at, labelled in the event timezone by the app (DST, T-ANA-03).

-- Counts only: no names or emails.
create function public.workshop_analytics(p_event_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with eligible as (
    select id from participants where event_id = p_event_id and status = 'accepted' and deleted_at is null and not is_test
  ), live as (
    select s.participant_id, s.checkpoint_id, s.scanned_at
      from scans s join checkpoints c on c.id = s.checkpoint_id join eligible e on e.id = s.participant_id
     where s.event_id = p_event_id and c.kind = 'session' and s.voided_at is null
  ), checked_in as (
    select distinct s.participant_id as id
      from scans s join checkpoints d on d.id = s.checkpoint_id join eligible e on e.id = s.participant_id
     where s.event_id = p_event_id and d.kind = 'door' and s.voided_at is null
  ), per_person as (
    select ci.id, count(l.participant_id) as n from checked_in ci left join live l on l.participant_id = ci.id group by ci.id
  ), per_workshop as (
    select c.id, c.name, c.is_open, c.capacity, c.starts_at, count(l.participant_id) as n
      from checkpoints c left join live l on l.checkpoint_id = c.id
     where c.event_id = p_event_id and c.kind = 'session'
     group by c.id
  )
  select jsonb_build_object(
    'checkedIn', (select count(*) from checked_in),
    'attendees', (select count(distinct participant_id) from live),
    'checkIns', (select count(*) from live),
    'cooldownMinutes', (select session_cooldown_minutes from events where id = p_event_id),
    'cooldownRefusals', (select count(*) from scan_attempts a join eligible e on e.id = a.participant_id
                          where a.event_id = p_event_id and a.result_code = 'SESSION_COOLDOWN'),
    -- Checked-in hackers by how many workshops they attended: 0, 1, 2, 3 or more.
    'distribution', jsonb_build_array(
      (select count(*) from per_person where n = 0), (select count(*) from per_person where n = 1),
      (select count(*) from per_person where n = 2), (select count(*) from per_person where n >= 3)),
    'workshops', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'isOpen', is_open, 'capacity', capacity, 'startsAt', starts_at, 'attendees', n)
                       order by n desc, name)
        from per_workshop), '[]'::jsonb),
    'buckets', coalesce((
      select jsonb_agg(jsonb_build_object('bucketUtc', b, 'count', n) order by b)
        from (select date_bin('15 minutes', l.scanned_at, e.starts_at) as b, count(*) as n
                from live l, events e where e.id = p_event_id group by 1) x), '[]'::jsonb))
$$;
revoke all on function public.workshop_analytics(uuid) from public, anon, authenticated;
grant execute on function public.workshop_analytics(uuid) to service_role;

-- The attendance list behind workshops.csv, for organizers (the route checks the role): names and times, no emails.
-- One jsonb value, so PostgREST's row cap (1000) can't silently cut a large event's export short.
create function public.workshop_attendance(p_event_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('workshop', c.name, 'firstName', pa.first_name, 'lastName', pa.last_name,
                                               'scannedAt', s.scanned_at, 'method', s.method)
                            order by c.name, s.scanned_at), '[]'::jsonb)
    from scans s
    join checkpoints c on c.id = s.checkpoint_id
    join participants pa on pa.id = s.participant_id
   where s.event_id = p_event_id and c.kind = 'session' and s.voided_at is null
     and pa.status = 'accepted' and pa.deleted_at is null and not pa.is_test
$$;
revoke all on function public.workshop_attendance(uuid) from public, anon, authenticated;
grant execute on function public.workshop_attendance(uuid) to service_role;

-- Connection game totals, never who met whom (F17 step 4). A mutual pair counts once, between two eligible
-- attendees, at the later of its two taps.
create function public.connection_analytics(p_event_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with eligible as (
    select id from participants where event_id = p_event_id and status = 'accepted' and deleted_at is null and not is_test
  ), taps as (
    select t.* from connection_taps t join eligible a on a.id = t.from_participant_id join eligible b on b.id = t.to_participant_id
     where t.event_id = p_event_id
  ), pairs as (
    select t.from_participant_id as a, t.to_participant_id as b, greatest(t.created_at, r.created_at) as at
      from taps t join taps r on r.from_participant_id = t.to_participant_id and r.to_participant_id = t.from_participant_id
     where t.from_participant_id < t.to_participant_id
  ), checked_in as (
    select distinct s.participant_id as id
      from scans s join checkpoints d on d.id = s.checkpoint_id join eligible e on e.id = s.participant_id
     where s.event_id = p_event_id and d.kind = 'door' and s.voided_at is null
  ), connected as (
    select a as id from pairs union select b from pairs
  )
  select jsonb_build_object(
    'mutual', (select count(*) from pairs),
    'waiting', (select count(*) from taps t where not exists (
                  select 1 from taps r where r.from_participant_id = t.to_participant_id and r.to_participant_id = t.from_participant_id)),
    'checkedIn', (select count(*) from checked_in),
    'connectedPeople', (select count(*) from connected),
    'buckets', coalesce((
      select jsonb_agg(jsonb_build_object('bucketUtc', b, 'count', n) order by b)
        from (select date_bin('1 hour', p.at, e.starts_at) as b, count(*) as n
                from pairs p, events e where e.id = p_event_id group by 1) x), '[]'::jsonb))
$$;
revoke all on function public.connection_analytics(uuid) from public, anon, authenticated;
grant execute on function public.connection_analytics(uuid) to service_role;
