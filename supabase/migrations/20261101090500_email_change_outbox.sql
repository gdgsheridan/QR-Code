-- A02 (2026-11-01): the one-inflight guarantee becomes per (participant_id, kind).
-- ingest_sheet_row returned PASS_QUEUED after an accepted-participant email change, but its
-- pass_reissued insert used `on conflict (participant_id) where status in ('pending','sending')`:
-- a deferred team_invite row in flight swallowed the reissue while the function still reported
-- PASS_QUEUED, and the old pass stayed active at the old address. The old pass is revoked by the
-- rotation in the drainer (issue_pass on send), so the fix is to make the queued row real: dedupe
-- per kind, so a pass_reissued coexists with other in-flight kinds. Every live ON CONFLICT arbiter
-- below is updated to match the new index (Postgres requires the arbiter to match an index, so the
-- old single-column arbiter would fail once the index is recreated). No other semantics change:
-- attempts, backoff, 429 handling, return contracts and IN_FLIGHT/QUEUED outcomes are untouched.
drop index if exists public.outbox_one_inflight;
create unique index outbox_one_inflight on email_outbox (participant_id, kind) where status in ('pending','sending');

-- ingest_sheet_row as in 20261031172218, plus per-kind dedupe so the pass_reissued row is really
-- queued: after an accepted-participant email change there is exactly one pending/sending
-- pass_reissued row for that participant. Return contract unchanged.
create or replace function public.ingest_sheet_row(
  p_event_id      uuid,
  p_external_id   text,
  p_email         text,
  p_first_name    text,
  p_last_name     text,
  p_search_text   text,
  p_dietary_notes text    default null,
  p_linkedin_url  text    default null,
  p_dry_run       boolean default false,
  p_sheet_status  text    default null
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  pa participants%rowtype;
  email_changed boolean;
begin
  select * into pa from participants where event_id = p_event_id and external_id = p_external_id for update;

  if not found then
    if exists (select 1 from participants where event_id = p_event_id and email = p_email) then
      return 'CONFLICT_DUPLICATE_EMAIL';
    end if;
    if p_dry_run then return 'CREATED'; end if;
    begin
      insert into participants (event_id, external_id, email, first_name, last_name, search_text,
                                dietary_notes, linkedin_url, status, source, sheet_status)
      values (p_event_id, p_external_id, p_email, p_first_name, p_last_name, p_search_text,
              p_dietary_notes, p_linkedin_url, 'pending', 'sheet', p_sheet_status)
      on conflict (event_id, external_id) do nothing
      returning * into pa;
    exception when unique_violation then
      -- (event_id, email) taken by a concurrent insert under another external_id.
      return 'CONFLICT_DUPLICATE_EMAIL';
    end;
    if found then return 'CREATED'; end if;
    -- A concurrent request inserted this external_id first: continue as an existing row.
    select * into pa from participants where event_id = p_event_id and external_id = p_external_id for update;
  end if;

  if pa.deleted_at is not null then
    return 'UNCHANGED';
  end if;

  email_changed := pa.email <> p_email;
  if not email_changed
     and pa.first_name    is not distinct from p_first_name
     and pa.last_name     is not distinct from p_last_name
     and (pa.dietary_set_at is not null or pa.dietary_notes is not distinct from p_dietary_notes)
     and (pa.linkedin_set_at is not null or pa.linkedin_url is not distinct from p_linkedin_url)
     and (p_sheet_status is null or pa.sheet_status is not distinct from p_sheet_status) then
    return 'UNCHANGED';
  end if;
  if email_changed and exists (select 1 from participants where event_id = p_event_id and email = p_email and id <> pa.id) then
    return 'CONFLICT_DUPLICATE_EMAIL';
  end if;
  if not p_dry_run then
    update participants
       set email = p_email, first_name = p_first_name, last_name = p_last_name, search_text = p_search_text,
           updated_at = now(),
           dietary_notes = case when pa.dietary_set_at is null then p_dietary_notes else pa.dietary_notes end,
           linkedin_url = case when pa.linkedin_set_at is null then p_linkedin_url else pa.linkedin_url end,
           sheet_status = coalesce(p_sheet_status, sheet_status),
           -- The RSVP link went to the old address: it must not answer (or make an account) for the new one.
           rsvp_token_hash = case when email_changed then null else rsvp_token_hash end
     where id = pa.id;
    if email_changed and pa.status = 'accepted' then
      -- Rotation on send revokes the old pass. A pending row already queued will go to the new address.
      -- A02: per-kind dedupe, so a deferred team_invite in flight no longer swallows this row.
      insert into email_outbox (participant_id, kind) values (pa.id, 'pass_reissued')
      on conflict (participant_id, kind) where status in ('pending','sending') do nothing;
      insert into audit_log (event_id, actor_kind, action, subject_id)
      values (p_event_id, 'sheet_sync', 'participant.email_change', pa.id);
    end if;
  end if;
  return case when email_changed and pa.status = 'accepted' then 'PASS_QUEUED' else 'UPDATED' end;
end $$;
revoke all on function public.ingest_sheet_row(uuid, text, text, text, text, text, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.ingest_sheet_row(uuid, text, text, text, text, text, text, text, boolean, text) to service_role;

-- team_invite as in 20261031182000, plus per-kind dedupe: a second invite within the hour is stored
-- but not emailed; other kinds in flight no longer suppress it.
create or replace function public.team_invite(p_participant_id uuid, p_email text, p_user_id uuid, p_invitee_id uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare pa participants%rowtype; ev events%rowtype;
begin
  -- v0.11.25: lock the inviter and the invitee, in id order, before any check. The invitee's "no team and
  -- looking" was read unlocked, so a join committing meanwhile left a stray invite (and its email) behind.
  -- A join locks its own row before the team, and this locks both rows before the team: no lock cycle.
  perform 1 from participants where id in (p_participant_id, p_invitee_id) order by id for update;
  select pa2.* into pa from participants pa2 join events e on e.id = pa2.event_id
   where pa2.id = p_participant_id and pa2.email = lower(btrim(p_email)) and pa2.status = 'accepted'
     and pa2.deleted_at is null and e.ends_at > now()
   for update of pa2;
  if not found then return 'NOT_FOUND'; end if;
  if p_invitee_id = pa.id then return 'SELF'; end if;
  select * into ev from events where id = pa.event_id;
  if not ev.teams_open then return 'CLOSED'; end if;
  if pa.team_id is null then return 'NOT_FOUND'; end if;
  perform 1 from teams where id = pa.team_id for update;
  if (select count(*) from participants where team_id = pa.team_id) >= 4 then return 'TEAM_FULL'; end if;
  if not exists (select 1 from participants where id = p_invitee_id and event_id = pa.event_id
                   and status = 'accepted' and deleted_at is null and team_id is null and looking_for_team) then
    return 'NOT_LOOKING';
  end if;
  insert into team_invites (team_id, participant_id, event_id, invited_by)
  values (pa.team_id, p_invitee_id, pa.event_id, pa.id) on conflict do nothing;
  if not found then return 'ALREADY_INVITED'; end if;
  -- A02: per-kind dedupe. At most one invite email an hour per person (v0.11.25): a new one waits
  -- until an hour after the last sent; invites arriving meanwhile ride along (the drainer counts every
  -- pending invite when it sends).
  insert into email_outbox (participant_id, kind, next_attempt_at)
  values (p_invitee_id, 'team_invite', greatest(now(), coalesce((
    select max(o.sent_at) + interval '1 hour' from email_outbox o
     where o.participant_id = p_invitee_id and o.kind = 'team_invite' and o.status = 'sent'), now())))
  on conflict (participant_id, kind) where status in ('pending','sending') do nothing;
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id)
  values (pa.event_id, p_user_id, 'participant', 'team.invite', pa.team_id);
  return 'INVITED';
end $$;

-- rsvp_respond as in 20261026170439, plus per-kind dedupe.
create or replace function public.rsvp_respond(
  p_token_hash text, p_going boolean,
  p_linkedin_url text default null, p_public boolean default null, p_dietary_notes text default null,
  p_emergency_name text default null, p_emergency_phone text default null, p_emergency_relation text default null,
  p_looking_for_team boolean default null
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare pa participants%rowtype; closes timestamptz;
begin
  select pa2.* into pa from participants pa2 join events e on e.id = pa2.event_id
   where pa2.rsvp_token_hash = p_token_hash and pa2.deleted_at is null and e.ends_at > now()
   for update of pa2;
  if not found then return 'NOT_FOUND'; end if;
  select _rsvp_closes(rsvp_deadline, pa.rsvp_sent_at) into closes from events where id = pa.event_id;

  if p_going then
    if pa.status <> 'accepted' and closes < now() then return 'CLOSED'; end if;
    update participants set looking_for_team = p_looking_for_team where id = pa.id and p_looking_for_team is not null;
    perform _set_hacker_profile(pa.id, p_linkedin_url, p_public, p_dietary_notes,
                                p_emergency_name, p_emergency_phone, p_emergency_relation);
    if pa.status <> 'accepted' then
      update participants set status = 'accepted', updated_at = now() where id = pa.id;
      insert into audit_log (event_id, actor_kind, action, subject_id) values (pa.event_id, 'participant', 'rsvp.yes', pa.id);
      if not exists (select 1 from passes where participant_id = pa.id and revoked_at is null)
         and coalesce((select revoke_reason from passes where participant_id = pa.id order by issued_at desc limit 1), '') <> 'manual' then
        -- A re-sent RSVP or a reminder still waiting in the outbox would otherwise block the pass email.
        update email_outbox set status = 'cancelled', locked_until = null
         where participant_id = pa.id and kind in ('rsvp', 'rsvp_reminder', 'profile_reminder') and status in ('pending','sending');
        insert into email_outbox (participant_id, kind) values (pa.id, 'pass_issued')
        on conflict (participant_id, kind) where status in ('pending','sending') do nothing;
      end if;
    end if;
    return 'GOING';
  end if;

  if pa.status <> 'withdrawn' then
    update participants set status = 'withdrawn', updated_at = now() where id = pa.id;
    update passes set revoked_at = now(), revoke_reason = 'status_change'
     where participant_id = pa.id and revoked_at is null;
    update email_outbox set status = 'cancelled', locked_until = null
     where participant_id = pa.id and status in ('pending','sending');
    delete from badges where participant_id = pa.id;  -- §6.5: revoking a pass removes the badge link
    insert into audit_log (event_id, actor_kind, action, subject_id) values (pa.event_id, 'participant', 'rsvp.no', pa.id);
  end if;
  return 'NOT_GOING';
end $$;

-- enqueue_pass as in 20261026170439, plus per-kind dedupe. IN_FLIGHT/QUEUED contract unchanged.
create or replace function public.enqueue_pass(p_event_id uuid, p_participant_id uuid, p_actor uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare pa participants%rowtype; queued uuid;
begin
  select * into pa from participants where id = p_participant_id and event_id = p_event_id and deleted_at is null for update;
  if not found then return 'NOT_FOUND'; end if;
  if pa.status <> 'accepted' then return 'NOT_ACCEPTED'; end if;
  update email_outbox set status = 'cancelled', locked_until = null
   where participant_id = pa.id and kind in ('rsvp_reminder', 'profile_reminder') and status in ('pending', 'sending');
  insert into email_outbox (participant_id, kind) values (pa.id, 'pass_reissued')
  on conflict (participant_id, kind) where status in ('pending', 'sending') do nothing
  returning id into queued;
  if queued is null then return 'IN_FLIGHT'; end if;
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id)
  values (p_event_id, p_actor, 'staff', 'pass.resend', pa.id);
  return 'QUEUED';
end $$;

-- queue_rsvps as in 20261026170439, plus per-kind dedupe.
create or replace function public.queue_rsvps(p_event_id uuid, p_participant_ids uuid[], p_actor uuid)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  perform 1 from participants where event_id = p_event_id and id = any(p_participant_ids) order by id for update;
  update email_outbox o set status = 'cancelled', locked_until = null
    from participants pa
   where pa.id = o.participant_id and pa.event_id = p_event_id and pa.id = any(p_participant_ids)
     and o.kind = 'rsvp_reminder' and o.status = 'pending';
  insert into email_outbox (participant_id, kind)
  select id, 'rsvp' from participants
   where event_id = p_event_id and id = any(p_participant_ids) and deleted_at is null and status <> 'accepted'
  on conflict (participant_id, kind) where status in ('pending','sending') do nothing;
  get diagnostics n = row_count;
  insert into audit_log (event_id, actor_user_id, actor_kind, action, detail)
  values (p_event_id, p_actor, 'staff', 'rsvp.send', jsonb_build_object('count', n));
  return n;
end $$;

-- run_rsvp_jobs as in 20261031200000, plus per-kind dedupe: a reminder coexists with other in-flight
-- kinds; only the same kind in flight suppresses that day's reminder.
create or replace function public.run_rsvp_jobs(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_expired uuid[]; v_events uuid[]; v_profile_events uuid[]; v_reminded int; v_profile_reminded int;
begin
  -- Reminder days due now: 10:00 local on the reply-by day when set (else the deadline day) and the two
  -- days before it, each once, and only if less than 6 h late (a scheduler that was down doesn't send
  -- yesterday's reminder at midnight).
  with due as (
    select e.id as event_id, d.run_on
      from events e
      -- v0.11.28: the reply-by day when set (else the deadline day) and the two days before it.
      cross join lateral (select (coalesce(e.rsvp_reply_by, e.rsvp_deadline) at time zone e.timezone)::date - g as run_on from generate_series(0, 2) g) d
     where coalesce(e.rsvp_reply_by, e.rsvp_deadline) is not null and e.ends_at > p_now
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
  -- A02: per-kind dedupe; a pass or invite in flight no longer suppresses that day's reminder.
  insert into email_outbox (participant_id, kind)
  select pa.id, 'rsvp_reminder' from participants pa join events e on e.id = pa.event_id
   where pa.event_id = any(v_events) and pa.status = 'pending' and pa.deleted_at is null
     and pa.rsvp_sent_at < p_now - interval '24 hours'  -- invited within the last day: the invitation is reminder enough
     and _rsvp_closes(e.rsvp_deadline, pa.rsvp_sent_at) > p_now
  on conflict (participant_id, kind) where status in ('pending','sending') do nothing;
  get diagnostics v_reminded = row_count;

  -- 3. The profile reminder (F14): finished means the emergency contact, overnight and team status are set.
  insert into email_outbox (participant_id, kind)
  select pa.id, 'profile_reminder' from participants pa
   where pa.event_id = any(v_profile_events) and pa.status = 'accepted' and pa.deleted_at is null
     and (pa.emergency_name is null or pa.overnight is null or pa.team_status is null)
  on conflict (participant_id, kind) where status in ('pending','sending') do nothing;
  get diagnostics v_profile_reminded = row_count;

  return jsonb_build_object('expired', cardinality(v_expired), 'reminded', v_reminded, 'profileReminded', v_profile_reminded);
end $$;
revoke all on function public.run_rsvp_jobs(timestamptz) from public, anon, authenticated;
grant execute on function public.run_rsvp_jobs(timestamptz) to service_role;
