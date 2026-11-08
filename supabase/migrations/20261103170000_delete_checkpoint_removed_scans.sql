-- SPEC §11 Checkpoints (v0.12, owner's request): a checkpoint is blocked from deletion only by a live scan. One whose
-- scans were all removed (voided, e.g. test scans) can be deleted, and those removed scans are deleted with it, the one
-- exception to "never hard-delete scans" (§5.1, I-9): they already count for nothing, and the audit row keeps how many.
-- Same lock as before: a scan being recorded holds the checkpoint row (FK), so it either lands first (HAS_SCANS) or
-- fails against the deleted checkpoint.
create or replace function public.delete_checkpoint(p_event_id uuid, p_checkpoint_id uuid, p_actor uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare removed int;
begin
  perform 1 from checkpoints where id = p_checkpoint_id and event_id = p_event_id for update;
  if not found then return 'NOT_FOUND'; end if;
  if exists (select 1 from scans where checkpoint_id = p_checkpoint_id and voided_at is null) then return 'HAS_SCANS'; end if;
  begin
    update scan_attempts set checkpoint_id = null where checkpoint_id = p_checkpoint_id;
    delete from scans where checkpoint_id = p_checkpoint_id and voided_at is not null;
    get diagnostics removed = row_count;
    delete from checkpoints where id = p_checkpoint_id;
  exception when foreign_key_violation then
    return 'HAS_SCANS'; -- a scan landed concurrently
  end;
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id, detail)
  values (p_event_id, p_actor, 'staff', 'checkpoint.delete', p_checkpoint_id, jsonb_build_object('removedScans', removed));
  return 'DELETED';
end $$;
revoke all on function public.delete_checkpoint(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_checkpoint(uuid, uuid, uuid) to service_role;
