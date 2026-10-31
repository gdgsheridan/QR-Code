-- SPEC F4 step 5 (v0.11.25): a provider's 429 is not a failed attempt. finish_outbox() can hand a row back
-- without charging the attempt (p_refund), counting rate-limited tries apart (p_rate_limited), so a burst of
-- rate limits retries instead of ending in 'failed' after 5 tries.
alter table email_outbox add column rate_limit_hits int not null default 0 check (rate_limit_hits >= 0);

drop function public.finish_outbox(uuid, outbox_status, timestamptz, text, text);
create function public.finish_outbox(
  p_id                  uuid,
  p_status              outbox_status,
  p_next_attempt_at     timestamptz default null,
  p_last_error          text        default null,
  p_provider_message_id text        default null,
  p_refund              boolean     default false,
  p_rate_limited        boolean     default false
) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_status = 'sending' then
    raise exception 'finish_outbox: status must be terminal or pending';
  end if;
  update email_outbox
     set status              = p_status,
         locked_until        = null,
         next_attempt_at     = coalesce(p_next_attempt_at, next_attempt_at),
         last_error          = coalesce(p_last_error, last_error),
         provider_message_id = coalesce(p_provider_message_id, provider_message_id),
         sent_at             = case when p_status = 'sent' then now() else sent_at end,
         attempts            = case when p_refund then greatest(attempts - 1, 0) else attempts end,
         rate_limit_hits     = case when p_rate_limited then rate_limit_hits + 1 else rate_limit_hits end
   where id = p_id and status = 'sending';
  return found;
end $$;
revoke all on function public.finish_outbox(uuid, outbox_status, timestamptz, text, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.finish_outbox(uuid, outbox_status, timestamptz, text, text, boolean, boolean) to service_role;

-- F13 (v0.11.25): the newest RSVP email (invitation or reminder) to this person failed for good.
create function public._rsvp_undelivered(p_participant_id uuid)
returns boolean language sql stable set search_path = public, pg_temp as $$
  select coalesce((select o.status = 'failed' from email_outbox o
                    where o.participant_id = p_participant_id and o.kind in ('rsvp', 'rsvp_reminder')
                    order by o.created_at desc limit 1), false)
$$;
revoke all on function public._rsvp_undelivered(uuid) from public, anon, authenticated;
grant execute on function public._rsvp_undelivered(uuid) to service_role;

-- As in 20261026171328_profile_setup, but an invitation whose email failed is never expired.
create or replace function public.run_rsvp_jobs(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_expired uuid[]; v_events uuid[]; v_profile_events uuid[]; v_reminded int; v_profile_reminded int;
begin
  -- Reminder days due now: 10:00 local on the deadline day and the two days before it, each once, and only
  -- if less than 6 h late (a scheduler that was down doesn't send yesterday's reminder at midnight).
  with due as (
    select e.id as event_id, d.run_on
      from events e
      cross join lateral (select (e.rsvp_deadline at time zone e.timezone)::date - g as run_on from generate_series(0, 2) g) d
     where e.rsvp_deadline is not null and e.ends_at > p_now
       and p_now >= (d.run_on + time '10:00') at time zone e.timezone
       and p_now < ((d.run_on + time '10:00') at time zone e.timezone) + interval '6 hours'
  ), fired as (
    insert into reminder_runs (event_id, kind, run_on) select event_id, 'rsvp', run_on from due
    on conflict do nothing returning event_id
  )
  select coalesce(array_agg(event_id), '{}') into v_events from fired;
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
           and (pa.event_id = any(v_events) or (e.ends_at > p_now and _rsvp_closes(e.rsvp_deadline, pa.rsvp_sent_at) < p_now)))
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

  -- 2. The RSVP reminders, to those who can still answer.
  -- shortcut: someone with another email in flight gets no reminder that day; split outbox_one_inflight by kind if that matters.
  insert into email_outbox (participant_id, kind)
  select pa.id, 'rsvp_reminder' from participants pa join events e on e.id = pa.event_id
   where pa.event_id = any(v_events) and pa.status = 'pending' and pa.deleted_at is null
     and pa.rsvp_sent_at < p_now - interval '24 hours'  -- invited within the last day: the invitation is reminder enough
     and _rsvp_closes(e.rsvp_deadline, pa.rsvp_sent_at) > p_now
  on conflict (participant_id) where status in ('pending','sending') do nothing;
  get diagnostics v_reminded = row_count;

  -- 3. The profile reminder (F14): finished means the emergency contact, overnight and team status are set.
  insert into email_outbox (participant_id, kind)
  select pa.id, 'profile_reminder' from participants pa
   where pa.event_id = any(v_profile_events) and pa.status = 'accepted' and pa.deleted_at is null
     and (pa.emergency_name is null or pa.overnight is null or pa.team_status is null)
  on conflict (participant_id) where status in ('pending','sending') do nothing;
  get diagnostics v_profile_reminded = row_count;

  return jsonb_build_object('expired', cardinality(v_expired), 'reminded', v_reminded, 'profileReminded', v_profile_reminded);
end $$;
