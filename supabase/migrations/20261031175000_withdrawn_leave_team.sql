-- F13/F15 (v0.11.25): someone who stops being accepted (a No, a missed deadline, a revoked RSVP, or any other
-- status change) leaves their team, so they don't hold a spot in it, and drops their invites and Looking.
-- If that empties the team, it is deleted, like the last member leaving. Teams an organizer left empty on
-- purpose are untouched: only the departure of their last member deletes one.
create function public._participant_left_accepted() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if old.status = 'accepted' and new.status <> 'accepted' then
    new.team_id := null;
    new.looking_for_team := false;
    delete from team_invites where participant_id = new.id;
  end if;
  return new;
end $$;
revoke all on function public._participant_left_accepted() from public, anon, authenticated;
grant execute on function public._participant_left_accepted() to service_role;
create trigger participants_left_accepted before update of status on participants
  for each row execute function public._participant_left_accepted();

create function public._participant_left_team_cleanup() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  delete from teams t where t.id = old.team_id
     and not exists (select 1 from participants p where p.team_id = old.team_id);
  return null;
end $$;
revoke all on function public._participant_left_team_cleanup() from public, anon, authenticated;
grant execute on function public._participant_left_team_cleanup() to service_role;
create trigger participants_left_team_cleanup after update of status on participants
  for each row when (old.status = 'accepted' and new.status <> 'accepted' and old.team_id is not null)
  execute function public._participant_left_team_cleanup();
