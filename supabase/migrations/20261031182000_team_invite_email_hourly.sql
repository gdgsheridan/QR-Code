-- F15 (v0.11.25): team invite emails at most once an hour per person (see below).
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
  -- shortcut: one in-flight email per participant; a second invite is stored but not emailed. Split the index by kind if needed.
  -- v0.11.25: at most one invite email an hour per person. A new one waits until an hour after the last sent;
  -- invites arriving meanwhile ride along (the drainer counts every pending invite when it sends).
  insert into email_outbox (participant_id, kind, next_attempt_at)
  values (p_invitee_id, 'team_invite', greatest(now(), coalesce((
    select max(o.sent_at) + interval '1 hour' from email_outbox o
     where o.participant_id = p_invitee_id and o.kind = 'team_invite' and o.status = 'sent'), now())))
  on conflict (participant_id) where status in ('pending','sending') do nothing;
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id)
  values (pa.event_id, p_user_id, 'participant', 'team.invite', pa.team_id);
  return 'INVITED';
end $$;
revoke all on function public.team_invite(uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.team_invite(uuid, text, uuid, uuid) to service_role;
