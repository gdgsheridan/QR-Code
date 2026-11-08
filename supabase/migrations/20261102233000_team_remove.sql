-- F15 (v0.11.44, owner's request): any member takes another member off their team while forming is open,
-- like an organizer can on the admin Teams page. The team gets a new join code (p_code, made by the app like
-- team_create's), so the removed person can't just rejoin with the one they already know.
create function public.team_remove(p_participant_id uuid, p_email text, p_user_id uuid, p_member_id uuid, p_code text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare pa participants%rowtype; ev events%rowtype;
begin
  -- Both rows in id order, then the team: the order team_invite() and delete_team() use. A joiner or leaver
  -- locks only its own row before the team, so two members removing each other (or a removal racing the
  -- member's own leave) serialize instead of deadlocking.
  perform 1 from participants where id in (p_participant_id, p_member_id) order by id for update;
  select pa2.* into pa from participants pa2 join events e on e.id = pa2.event_id
   where pa2.id = p_participant_id and pa2.email = lower(btrim(p_email)) and pa2.status = 'accepted'
     and pa2.deleted_at is null and e.ends_at > now();
  if not found or pa.team_id is null or p_member_id = pa.id then return 'NOT_FOUND'; end if;
  select * into ev from events where id = pa.event_id;
  if not ev.teams_open then return 'CLOSED'; end if;
  perform 1 from teams where id = pa.team_id for update;
  -- _participant_left_team() puts them back under Looking when their answer is looking.
  update participants set team_id = null where id = p_member_id and team_id = pa.team_id;
  if not found then return 'NOT_FOUND'; end if;
  begin
    update teams set join_code = p_code where id = pa.team_id;
  exception when unique_violation then
    null;  -- about once in 10^10 tries, a code this event already has: the old code stays
  end;
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id, detail)
  values (pa.event_id, p_user_id, 'participant', 'team.remove', p_member_id, jsonb_build_object('teamId', pa.team_id));
  return 'REMOVED';
end $$;
revoke all on function public.team_remove(uuid, text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.team_remove(uuid, text, uuid, uuid, text) to service_role;
