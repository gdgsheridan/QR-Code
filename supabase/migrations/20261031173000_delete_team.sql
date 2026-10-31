-- §11 Teams (v0.11.25): an organizer deleting a team locks its members before the team, in id order, the
-- same order as team_leave()/team_set_track() (own row, then the team). A plain DELETE locked the team first
-- and then the members (on delete set null), and deadlocked with a member leaving or picking a track.
create function public.delete_team(p_event_id uuid, p_team_id uuid, p_actor uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform 1 from participants where team_id = p_team_id and event_id = p_event_id order by id for update;
  delete from teams where id = p_team_id and event_id = p_event_id;
  if not found then return 'NOT_FOUND'; end if;
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id)
  values (p_event_id, p_actor, 'staff', 'team.delete', p_team_id);
  return 'DELETED';
end $$;
revoke all on function public.delete_team(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_team(uuid, uuid, uuid) to service_role;
