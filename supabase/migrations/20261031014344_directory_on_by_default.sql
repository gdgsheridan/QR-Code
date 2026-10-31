-- SPEC F16 (v0.11.19, owner's decision): accepted hackers are listed in the private Hacker directory by default.
-- They can switch it off on /me/profile (Networking). Tombstones still clear it (delete_participant).

alter table participants alter column directory_opt_in set default true;

-- On for people who never made a choice. Every save of the networking form records `directoryOptIn` in the
-- profile.update audit row (save_hacker_profile), so anyone who saved it, on or off, keeps what they chose.
update participants pa set directory_opt_in = true
 where not pa.directory_opt_in and pa.deleted_at is null
   and not exists (select 1 from audit_log a
                    where a.subject_id = pa.id and a.action = 'profile.update' and a.detail ? 'directoryOptIn');
