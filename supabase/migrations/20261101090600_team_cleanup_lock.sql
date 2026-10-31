-- A08 (2026-11-01): the withdrawn-participant team cleanup raced a concurrent join. It deleted the team
-- when no member row referenced it yet, without holding the team row: a join that set team_id between the
-- emptiness check and the delete left the joiner pointing at a deleted team (FK set null), and the join
-- still answered JOINED. The cleanup now locks the team row first -- the same lock the join path takes in
-- _participant_team(), and team_leave() takes before its own delete -- so a join either lands first (the
-- team stays) or waits and finds the team gone (BAD_CODE): it cannot interleave between the check and the
-- delete. Product rule unchanged: only the departure of a team's last member deletes it;
-- organizer-emptied teams stay.
create or replace function public._participant_left_team_cleanup() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  -- Lock order matches team_join()/team_leave() (own participant row, already held by the update that
  -- fired this trigger, then the team row), so this cannot deadlock with a joiner: _participant_team()
  -- takes the same two locks in the same order.
  perform 1 from teams where id = old.team_id for update;
  if not found then return null; end if;
  delete from teams t where t.id = old.team_id
     and not exists (select 1 from participants p where p.team_id = old.team_id);
  return null;
end $$;
revoke all on function public._participant_left_team_cleanup() from public, anon, authenticated;
grant execute on function public._participant_left_team_cleanup() to service_role;
