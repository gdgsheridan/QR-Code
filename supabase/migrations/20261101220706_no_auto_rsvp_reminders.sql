-- v0.11.35 (owner's request): no automatic RSVP reminders. run_rsvp_jobs() as in 20261101090500, without
-- the reminder days and step 2; organizers send a reminder by sending the RSVP again (the drainer words a
-- re-send to someone who already got one as the reminder, SPEC F13). The missed-deadline no and the
-- profile reminder stay.
create or replace function public.run_rsvp_jobs(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_expired uuid[]; v_profile_events uuid[]; v_profile_reminded int;
begin
  -- The profile reminder: 10:00 local two days before the event starts, once.
  with due as (
    select e.id as event_id, (e.starts_at at time zone e.timezone)::date - 2 as run_on, e.timezone
      from events e
     where e.ends_at > p_now
  ), fired as (
    insert into reminder_runs (event_id, kind, run_on)
    select event_id, 'profile', run_on from due
     where p_now >= (run_on + time '10:00') at time zone timezone
       and p_now < ((run_on + time '10:00') at time zone timezone) + interval '6 hours'
    on conflict do nothing returning event_id
  )
  select coalesce(array_agg(event_id), '{}') into v_profile_events from fired;

  -- Lock everyone any step may change, once and in id order (like queue_rsvps()), so this can't
  -- deadlock with an answer, an RSVP send or another run.
  perform 1 from participants pa join events e on e.id = pa.event_id
   where pa.deleted_at is null
     and ((pa.status = 'pending' and pa.rsvp_sent_at is not null
           and e.ends_at > p_now and _rsvp_closes(e.rsvp_deadline, pa.rsvp_sent_at) < p_now)
          or (pa.status = 'accepted' and pa.event_id = any(v_profile_events)))
   -- no key update: never blocks a foreign-key check (e.g. a team invite to them), so no lock cycle with one.
   order by pa.id for no key update of pa;

  -- 1. No reply by their deadline counts as a no: the same as answering No. Their link stays, to say so.
  with gone as (
    update participants pa set status = 'withdrawn', updated_at = now()
      from events e
     where e.id = pa.event_id and pa.status = 'pending' and pa.deleted_at is null and pa.rsvp_sent_at is not null
       and e.ends_at > p_now and _rsvp_closes(e.rsvp_deadline, pa.rsvp_sent_at) < p_now
       -- An organizer's re-send still waiting to go out restarts their 48 h once it is sent.
       and not exists (select 1 from email_outbox o where o.participant_id = pa.id and o.kind = 'rsvp' and o.status in ('pending','sending'))
       -- v0.11.25: nor when their newest invitation email (or reminder, which replaced the link) failed for good:
       -- they never got a working link, so silence isn't a no. Organizers see "RSVP failed" and resend.
       and not _rsvp_undelivered(pa.id)
    returning pa.id, pa.event_id
  ), logged as (
    insert into audit_log (event_id, actor_kind, action, subject_id) select event_id, 'system', 'rsvp.expire', id from gone
  )
  select coalesce(array_agg(id), '{}') into v_expired from gone;
  update passes set revoked_at = now(), revoke_reason = 'status_change' where participant_id = any(v_expired) and revoked_at is null;
  update email_outbox set status = 'cancelled', locked_until = null where participant_id = any(v_expired) and status in ('pending','sending');
  delete from badges where participant_id = any(v_expired);

  -- 2. The profile reminder (F14): finished means the emergency contact, overnight and team status are set.
  insert into email_outbox (participant_id, kind)
  select pa.id, 'profile_reminder' from participants pa
   where pa.event_id = any(v_profile_events) and pa.status = 'accepted' and pa.deleted_at is null
     and (pa.emergency_name is null or pa.overnight is null or pa.team_status is null)
  on conflict (participant_id, kind) where status in ('pending','sending') do nothing;
  get diagnostics v_profile_reminded = row_count;

  return jsonb_build_object('expired', cardinality(v_expired), 'profileReminded', v_profile_reminded);
end $$;
revoke all on function public.run_rsvp_jobs(timestamptz) from public, anon, authenticated;
grant execute on function public.run_rsvp_jobs(timestamptz) to service_role;
