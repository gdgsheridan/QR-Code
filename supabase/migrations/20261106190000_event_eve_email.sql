-- SPEC §12 / §11 (v0.12.3, owner's request): the "See you tomorrow" check-in email, sent from the Participants page
-- to everyone who said Yes (accepted) and hasn't had it yet. It goes through the outbox like every other email; the
-- drainer re-checks at send time that they are still accepted and undeleted, and it carries no token.
alter table email_outbox
  drop constraint email_outbox_kind_check,
  add constraint email_outbox_kind_check
    check (kind in ('pass_issued', 'pass_reissued', 'rsvp', 'team_invite', 'rsvp_reminder', 'profile_reminder', 'staff_added', 'event_eve'));

-- Queues (or, with p_dry_run, only counts) one event_eve email per accepted, undeleted participant of the event who
-- has none pending, sending or sent; a failed one is queued again. p_participant_ids narrows it (a test send).
create or replace function public.queue_event_eve(p_event_id uuid, p_actor uuid, p_participant_ids uuid[] default null, p_dry_run boolean default false)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  if p_dry_run then
    select count(*) into n from participants pa
     where pa.event_id = p_event_id and pa.status = 'accepted' and pa.deleted_at is null
       and (p_participant_ids is null or pa.id = any(p_participant_ids))
       and not exists (select 1 from email_outbox o where o.participant_id = pa.id and o.kind = 'event_eve' and o.status in ('pending', 'sending', 'sent'));
    return n;
  end if;
  -- Lock in id order, like queue_rsvps(), so a press can't deadlock with an RSVP answer or another press.
  perform 1 from participants pa
   where pa.event_id = p_event_id and (p_participant_ids is null or pa.id = any(p_participant_ids))
   order by pa.id for update;
  insert into email_outbox (participant_id, kind)
  select pa.id, 'event_eve' from participants pa
   where pa.event_id = p_event_id and pa.status = 'accepted' and pa.deleted_at is null
     and (p_participant_ids is null or pa.id = any(p_participant_ids))
     and not exists (select 1 from email_outbox o where o.participant_id = pa.id and o.kind = 'event_eve' and o.status in ('pending', 'sending', 'sent'))
  on conflict (participant_id, kind) where status in ('pending', 'sending') do nothing;
  get diagnostics n = row_count;
  insert into audit_log (event_id, actor_user_id, actor_kind, action, detail)
  values (p_event_id, p_actor, 'staff', 'email.event_eve', jsonb_build_object('count', n));
  return n;
end $$;

revoke all on function public.queue_event_eve(uuid, uuid, uuid[], boolean) from public, anon, authenticated;
grant execute on function public.queue_event_eve(uuid, uuid, uuid[], boolean) to service_role;
