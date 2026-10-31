-- M3 (2026-11-01): role grants require a confirmed account email.
-- consume_staff_invites() and grant_admin_roles() matched only lower(email): with "Confirm email"
-- disabled, anyone registering an invited (or ADMIN_EMAILS) address became staff/organizer. Both now
-- require the matched auth.users row to have email_confirmed_at set; an unconfirmed account grants
-- nothing (consume returns 0, grant returns 0) and invites stay pending until the address is confirmed.
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
  with consumed as (
    delete from staff_invites where email = email_norm returning event_id, role
  )
  insert into event_staff (event_id, user_id, role)
  select event_id, p_user_id, role from consumed
  on conflict (event_id, user_id) do update set role = excluded.role;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.consume_staff_invites(uuid, text) from public, anon, authenticated;
grant execute on function public.consume_staff_invites(uuid, text) to service_role;

-- grant_admin_roles() takes no email: the caller (landingAfterSignIn) already matched ADMIN_EMAILS.
-- The grant itself now requires the account's email to be confirmed, else it grants nothing (0).
create or replace function public.grant_admin_roles(p_user_id uuid)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  if not exists (select 1 from auth.users where id = p_user_id and email_confirmed_at is not null) then
    return 0;
  end if;
  insert into event_staff (event_id, user_id, role)
  select id, p_user_id, 'organizer' from events
  on conflict (event_id, user_id) do update set role = 'organizer';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.grant_admin_roles(uuid) from public, anon, authenticated;
grant execute on function public.grant_admin_roles(uuid) to service_role;
