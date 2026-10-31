-- F14/F15 (v0.11.25): someone whose profile says they're looking for a team and who leaves (or is removed
-- from) a team while still accepted goes back under Looking. Joining turned Looking off (_participant_team()),
-- and nothing turned it back on, so they vanished from the Looking filter while their profile said looking.
create function public._participant_left_team() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.team_id is null and new.status = 'accepted' and new.deleted_at is null and new.team_status = 'looking' then
    new.looking_for_team := true;
  end if;
  return new;
end $$;
revoke all on function public._participant_left_team() from public, anon, authenticated;
grant execute on function public._participant_left_team() to service_role;
create trigger participants_left_team before update of team_id on participants
  for each row when (old.team_id is not null and new.team_id is null)
  execute function public._participant_left_team();
