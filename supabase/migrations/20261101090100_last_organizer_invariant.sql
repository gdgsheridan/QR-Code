-- A06 (2026-11-01): the last organizer cannot be demoted through invite_staff()/consume_staff_invites().
-- Only remove_staff() refused LAST_ORGANIZER, so re-inviting the sole organizer as volunteer (or signing
-- in on such an invite) left the event with none. Both role-mutating paths now refuse that demotion:
-- invite_staff() returns LAST_ORGANIZER like remove_staff(); consume_staff_invites() leaves the
-- violating invite pending and skips it. The event-row lock serializes with remove_staff(), which takes
-- the same lock, so a concurrent demote and remove cannot both slip through. The M3 confirmed-email
-- checks from 20261101090000 are repeated here so each function body stays whole (create or replace).
create or replace function public.invite_staff(p_event_id uuid, p_email text, p_role staff_role, p_actor uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid; email_norm text := lower(btrim(p_email)); result text;
begin
  -- Serialize with remove_staff(), which locks the same row, so a demote and a remove cannot race.
  perform 1 from events where id = p_event_id for update;
  select id into uid from auth.users where lower(email) = email_norm limit 1;
  if uid is not null then
    -- A06: never demote the sole organizer through an invite upsert.
    if p_role <> 'organizer'
       and exists (select 1 from event_staff where event_id = p_event_id and user_id = uid and role = 'organizer')
       and (select count(*) from event_staff where event_id = p_event_id and role = 'organizer') = 1 then
      return 'LAST_ORGANIZER';
    end if;
    insert into event_staff (event_id, user_id, role) values (p_event_id, uid, p_role)
    on conflict (event_id, user_id) do update set role = excluded.role;
    delete from staff_invites where event_id = p_event_id and email = email_norm;
    insert into email_outbox (kind, event_id, user_id) values ('staff_added', p_event_id, uid)
    on conflict (user_id, event_id) where kind = 'staff_added' and status in ('pending','sending') do nothing;
    result := 'ADDED';
  else
    insert into staff_invites (event_id, email, role) values (p_event_id, email_norm, p_role)
    on conflict (event_id, email) do update set role = excluded.role;
    result := 'INVITED';
  end if;
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id, detail)
  values (p_event_id, p_actor, 'staff', 'staff.invite', uid, jsonb_build_object('role', p_role, 'result', result));
  return result;
end $$;
revoke all on function public.invite_staff(uuid, text, staff_role, uuid) from public, anon, authenticated;
grant execute on function public.invite_staff(uuid, text, staff_role, uuid) to service_role;

-- Same last-organizer invariant on the consume path (M3 check retained). A demotion that would leave
-- the event with no organizer is not consumed: the invite stays pending until another organizer exists.
create or replace function public.consume_staff_invites(p_user_id uuid, p_email text)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare n int; email_norm text := lower(btrim(p_email));
begin
  if not exists (
    select 1 from auth.users
     where id = p_user_id and lower(email) = email_norm and email_confirmed_at is not null
  ) then
    return 0;
  end if;
  -- Lock every event with a pending invite for this address, in id order (like team_invite()), so a
  -- concurrent remove_staff() or invite_staff() on the same event serializes instead of racing.
  perform 1 from events where id in (select event_id from staff_invites where email = email_norm) order by id for update;
  with consumed as (
    delete from staff_invites
     where email = email_norm
       and not (
         role <> 'organizer'
         and exists (select 1 from event_staff where event_id = staff_invites.event_id and user_id = p_user_id and role = 'organizer')
         and (select count(*) from event_staff es where es.event_id = staff_invites.event_id and es.role = 'organizer') = 1
       )
    returning event_id, role
  )
  insert into event_staff (event_id, user_id, role)
  select event_id, p_user_id, role from consumed
  on conflict (event_id, user_id) do update set role = excluded.role;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.consume_staff_invites(uuid, text) from public, anon, authenticated;
grant execute on function public.consume_staff_invites(uuid, text) to service_role;
