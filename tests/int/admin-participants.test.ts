import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateToken, sha256hex } from '@/lib/domain/token';
import { PHOTO_BUCKET, photoPath } from '@/lib/storage/photos';
import { adminClient, obj } from '../fixtures/admin-api';
import { onlyEmailTo, tokenFromEmail } from '../fixtures/mail';
import { signInAs } from '../fixtures/staff';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

let f: StandardFixture;
let org: string;
const c = adminClient();
beforeAll(async () => {
  f = await createStandardFixture();
  org = await signInAs(f.staffEmail.org1);
});
afterAll(async () => {
  await f.close();
});

describe('participants admin (SPEC §11, F12, §5.1)', () => {
  it('T-ADM-03: add a walk-in with "check in now" → source walk_in, accepted, live manual door scan', async () => {
    const email = ` Walk.In+${f.slug}@Example.test `;
    const res = await c.call('addWalkIn', org, { slug: f.slug }, { body: { firstName: 'Walk', lastName: 'In', email, checkInNow: true, sendPass: false } });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ code: 'CREATED', scan: { code: 'ACCEPTED' } });
    const id = String(obj(res.body).participantId);
    const { rows } = await f.pool.query<{ source: string; status: string; email: string; search_text: string }>(
      'select source, status, email, search_text from participants where id = $1',
      [id],
    );
    expect(rows[0]).toEqual({ source: 'walk_in', status: 'accepted', email: `walk.in+${f.slug}@example.test`, search_text: 'walk in' });
    const { rows: scans } = await f.pool.query('select method from scans where participant_id = $1 and checkpoint_id = $2 and voided_at is null', [id, f.cp.D]);
    expect(scans).toEqual([{ method: 'manual' }]);
    const dup = await c.call('addWalkIn', org, { slug: f.slug }, { body: { firstName: 'X', lastName: '', email, checkInNow: false, sendPass: false } });
    expect(dup.status).toBe(409);
  });

  it('F12: walk-in with "send pass" queues exactly one pass email', async () => {
    const res = await c.call('addWalkIn', org, { slug: f.slug }, {
      body: { firstName: 'Mail', lastName: 'Me', email: `mail.me+${f.slug}@example.test`, checkInNow: false, sendPass: true },
    });
    const id = String(obj(res.body).participantId);
    const { rows } = await f.pool.query('select kind, status from email_outbox where participant_id = $1', [id]);
    expect(rows).toEqual([{ kind: 'pass_issued', status: 'pending' }]);
    expect(c.scheduled.length).toBeGreaterThan(0);
  });

  it('T-ADM-09: add a person who is not RSVPed yet → pending applicant, nothing sent; Send RSVP then emails them; contradictions are 400', async () => {
    const email = `apply.me+${f.slug}@example.test`;
    const before = c.scheduled.length;
    const res = await c.call('addWalkIn', org, { slug: f.slug }, { body: { firstName: 'Apply', lastName: 'Me', email, notRsvped: true } });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ code: 'CREATED' });
    const id = String(obj(res.body).participantId);
    expect((await f.pool.query('select source, status from participants where id = $1', [id])).rows).toEqual([{ source: 'walk_in', status: 'pending' }]);
    expect((await f.pool.query('select 1 from email_outbox where participant_id = $1', [id])).rowCount).toBe(0);
    expect((await f.pool.query('select 1 from scans where participant_id = $1 union all select 1 from passes where participant_id = $1', [id])).rowCount).toBe(0);
    expect(c.scheduled.length).toBe(before);
    const audit = await f.pool.query('select detail from audit_log where subject_id = $1 and action = $2', [id, 'participant.applicant']);
    expect(audit.rows).toEqual([{ detail: {} }]);

    // The point of it: Send RSVP works on them like on any applicant, and the RSVP email goes out.
    expect((await c.call('sendRsvps', org, { slug: f.slug }, { body: { ids: [id] } })).body).toEqual({ queued: 1 });
    await c.drain();
    expect(onlyEmailTo(c.mail.sent, email).text).toMatch(/\/rsvp#[A-Za-z0-9_-]{32}/);

    for (const contradiction of [{ checkInNow: true }, { sendPass: true }]) {
      const bad = await c.call('addWalkIn', org, { slug: f.slug }, { body: { firstName: 'No', email: `no+${f.slug}@example.test`, notRsvped: true, ...contradiction } });
      expect(bad.status, JSON.stringify(contradiction)).toBe(400);
    }
    const dup = await c.call('addWalkIn', org, { slug: f.slug }, { body: { firstName: 'Dup', email, notRsvped: true } });
    expect(dup.status).toBe(409);
  });

  it('T-ADM-05: delete → tombstone per §5.1; counts unchanged; old token → REVOKED (deleted); no PII in audit', async () => {
    const path = photoPath(f.e1.id, f.p.B);
    const { error: uploadError } = await c.db.storage.from(PHOTO_BUCKET).upload(path, Buffer.from([0xff, 0xd8, 0xff, 0xd9]), { contentType: 'image/jpeg', upsert: true });
    expect(uploadError).toBeNull();
    await f.pool.query('update participants set photo_path = $2, photo_updated_at = now() where id = $1', [f.p.B, path]);
    await f.pool.query(
      `update participants set emergency_name = 'Sam Lee', emergency_phone = '555 0100', emergency_relation = 'Parent',
         overnight = 'yes', allergies = 'Peanuts', allergy_severity = 'severe', team_status = 'solo', accessibility = 'Ramp' where id = $1`,
      [f.p.B],
    );
    await f.scan({ cp: f.cp.R, staff: f.staff.vol1, token: f.token.B });
    const before = await f.pool.query<{ n: number }>('select count(*)::int as n from scans where event_id = $1 and voided_at is null', [f.e1.id]);
    const res = await c.call('deleteParticipant', org, { slug: f.slug, id: f.p.B }, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const { data: objects, error: listError } = await c.db.storage.from(PHOTO_BUCKET).list(f.e1.id);
    expect(listError).toBeNull();
    expect(objects?.map((o) => o.name)).not.toContain(`${f.p.B}.jpg`);
    const { rows } = await f.pool.query(
      `select first_name, last_name, email, search_text, dietary_notes, linkedin_url, photo_path,
              emergency_name, emergency_phone, emergency_relation, deleted_at is not null as deleted,
              overnight, allergies, allergy_severity, team_status, accessibility
         from participants where id = $1`,
      [f.p.B],
    );
    expect(rows[0]).toEqual({
      first_name: 'Deleted', last_name: '', email: `deleted+${f.p.B}@invalid`, search_text: '',
      dietary_notes: null, linkedin_url: null, photo_path: null,
      emergency_name: null, emergency_phone: null, emergency_relation: null, deleted: true,
      overnight: null, allergies: null, allergy_severity: null, team_status: null, accessibility: null, // v0.9
    });
    const after = await f.pool.query<{ n: number }>('select count(*)::int as n from scans where event_id = $1 and voided_at is null', [f.e1.id]);
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
    expect(await f.scan({ cp: f.cp.D, staff: f.staff.vol1, token: f.token.B })).toMatchObject({ code: 'REVOKED', revokeReason: 'deleted' });
    const { rows: audit } = await f.pool.query<{ detail: unknown }>(`select detail from audit_log where action = 'participant.delete' and subject_id = $1`, [f.p.B]);
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0]?.detail)).not.toMatch(/Ben|@/);
    expect((await c.call('deleteParticipant', org, { slug: f.slug, id: f.p.B }, { method: 'DELETE' })).body).toMatchObject({ code: 'ALREADY_DELETED' });
  });

  it('T-ADM-11: Revoke RSVP (v0.9.1) puts someone back to not invited: dead link, no pass or badge, waiting email cancelled; a new RSVP then works', async () => {
    const { id, token } = await f.addParticipant(f.e1.id); // accepted, with a pass
    await f.linkBadge(id);
    await f.pool.query(`update participants set rsvp_token_hash = repeat('a', 64), rsvp_sent_at = now() where id = $1`, [id]);
    await f.pool.query(`insert into email_outbox (participant_id, kind) values ($1, 'profile_reminder')`, [id]);

    const vol = await signInAs(f.staffEmail.vol1);
    expect((await c.call('revokeRsvp', vol, { slug: f.slug, id }, { method: 'POST' })).status).toBe(403);
    for (const other of [f.p.X, 'not-a-uuid']) expect((await c.call('revokeRsvp', org, { slug: f.slug, id: other }, { method: 'POST' })).status).toBe(404);

    expect((await c.call('revokeRsvp', org, { slug: f.slug, id }, { method: 'POST' })).body).toEqual({ code: 'RESET' });
    const { rows } = await f.pool.query(
      `select status, rsvp_token_hash, rsvp_sent_at,
              (select revoke_reason from passes where participant_id = p.id order by issued_at desc limit 1) as pass,
              exists (select 1 from badges where participant_id = p.id) as badge,
              (select array_agg(status::text) from email_outbox where participant_id = p.id) as outbox
         from participants p where id = $1`,
      [id],
    );
    expect(rows[0]).toEqual({ status: 'pending', rsvp_token_hash: null, rsvp_sent_at: null, pass: 'status_change', badge: false, outbox: ['cancelled'] });
    expect(await f.scan({ cp: f.cp.D, staff: f.staff.vol1, token: token ?? '' })).toMatchObject({ code: 'REVOKED' });
    const audit = await f.pool.query(`select actor_kind, detail from audit_log where action = 'rsvp.reset' and subject_id = $1`, [id]);
    expect(audit.rows).toEqual([{ actor_kind: 'staff', detail: {} }]);

    // A fresh RSVP: queued, and a Yes to it issues a new pass (the old one wasn't revoked by hand).
    expect((await c.call('sendRsvps', org, { slug: f.slug }, { body: { ids: [id] } })).body).toEqual({ queued: 1 });
    await f.pool.query(`update email_outbox set status = 'cancelled' where participant_id = $1 and status = 'pending'`, [id]);
    const hash = sha256hex(generateToken()); // random: the local DB keeps rows between runs
    await f.pool.query(`update participants set rsvp_token_hash = $2, rsvp_sent_at = now() where id = $1`, [id, hash]);
    expect((await f.pool.query<{ r: string }>(`select rsvp_respond($1, true) as r`, [hash])).rows[0]?.r).toBe('GOING');
    expect((await f.pool.query(`select 1 from email_outbox where participant_id = $1 and kind = 'pass_issued' and status = 'pending'`, [id])).rows).toHaveLength(1);
    await f.pool.query(`update email_outbox set status = 'cancelled' where participant_id = $1 and status = 'pending'`, [id]);
  });

  it('T-MAIL-11 (route): resend queues pass_reissued, rotating the pass; a second resend while in flight is not queued twice', async () => {
    const first = await c.call('resendPass', org, { slug: f.slug, id: f.p.N }, { method: 'POST' });
    expect(first.body).toEqual({ code: 'QUEUED' });
    expect((await c.call('resendPass', org, { slug: f.slug, id: f.p.N }, { method: 'POST' })).body).toEqual({ code: 'IN_FLIGHT' });
    await c.drain();
    const { rows } = await f.pool.query<{ email: string }>('select email from participants where id = $1', [f.p.N]);
    const fresh = tokenFromEmail(onlyEmailTo(c.mail.sent, rows[0]?.email ?? ''));
    expect((await f.scan({ cp: f.cp.D, staff: f.staff.vol1, token: f.token.N })).code).toBe('REVOKED');
    expect((await f.scan({ cp: f.cp.D, staff: f.staff.vol1, token: fresh })).code).not.toBe('REVOKED');
    expect((await c.call('resendPass', org, { slug: f.slug, id: f.p.C }, { method: 'POST' })).body).toEqual({ code: 'NOT_ACCEPTED' });
  });

  it('§11: revoke (manual) cancels the active pass; mark test flags the participant', async () => {
    expect((await c.call('revokePass', org, { slug: f.slug, id: f.p.Rv }, { method: 'POST' })).body).toEqual({ code: 'REVOKED' });
    expect(await f.scan({ cp: f.cp.D, staff: f.staff.vol1, token: f.token.Rv })).toMatchObject({ code: 'REVOKED', revokeReason: 'manual' });
    expect((await c.call('markTest', org, { slug: f.slug, id: f.p.N }, { body: { isTest: true } })).status).toBe(200);
    const { rows } = await f.pool.query<{ is_test: boolean }>('select is_test from participants where id = $1', [f.p.N]);
    expect(rows[0]?.is_test).toBe(true);
  });

  it('§11: list filters by status and no-shows; detail includes scan history with voided scans', async () => {
    const waitlisted = await c.call('listParticipants', org, { slug: f.slug }, { query: { status: 'waitlisted' } });
    expect((obj(waitlisted.body).participants as Array<{ id: string }>).map((p) => p.id)).toEqual([f.p.C]);
    expect(Object.keys((obj(waitlisted.body).participants as Array<object>)[0] ?? {}).sort()).toEqual([
      'applicantId', 'checkedIn', 'dietaryNotes', 'email', 'firstName', 'hasBadge', 'id',
      'isTest', 'lastName', 'liveScans', 'passState', 'rsvpFailed', 'rsvpSentAt', 'source', 'status',
    ].sort());
    // T-MAIL-15 (v0.11.25): C's newest RSVP email failed for good, so the row says so; an older failure doesn't count.
    expect((obj(waitlisted.body).participants as Array<{ rsvpFailed: boolean }>)[0]?.rsvpFailed).toBe(false);
    await f.pool.query(`insert into email_outbox (participant_id, kind, status, created_at) values ($1, 'rsvp', 'failed', now() - interval '1 day'), ($1, 'rsvp', 'sent', now() - interval '1 hour')`, [f.p.C]);
    const older = await c.call('listParticipants', org, { slug: f.slug }, { query: { status: 'waitlisted' } });
    expect((obj(older.body).participants as Array<{ rsvpFailed: boolean }>)[0]?.rsvpFailed).toBe(false);
    await f.pool.query(`insert into email_outbox (participant_id, kind, status) values ($1, 'rsvp_reminder', 'failed')`, [f.p.C]);
    const failed = await c.call('listParticipants', org, { slug: f.slug }, { query: { status: 'waitlisted' } });
    expect((obj(failed.body).participants as Array<{ rsvpFailed: boolean }>)[0]?.rsvpFailed).toBe(true);
    const scan = await f.scan({ cp: f.cp.R, staff: f.staff.vol1, token: f.token.T });
    await f.voidScan(scan.scanId ?? '', f.staff.org1);
    const detail = await c.call('getParticipant', org, { slug: f.slug, id: f.p.T });
    expect(obj(detail.body).participant).toMatchObject({ id: f.p.T, firstName: 'Tess', isTest: true });
    expect(Object.keys(obj(obj(detail.body).participant)).sort()).toEqual([
      'accessibility', 'allergies', 'allergySeverity', 'applicantId', 'dietaryNotes', 'email',
      'emergency', 'firstName', 'id', 'isTest', 'lastName', 'linkedinUrl', 'overnight', 'source', 'status', 'teamStatus',
    ].sort());
    expect(obj(detail.body).scans).toEqual([expect.objectContaining({ checkpointName: 'Raffle', voided: true, voidReason: 'Test scan' })]);
    const noShows = await c.call('listParticipants', org, { slug: f.slug }, { query: { noShow: '1' } });
    const ids = (obj(noShows.body).participants as Array<{ id: string }>).map((p) => p.id);
    expect(ids).toContain(f.p.A);
    expect(ids).not.toContain(f.p.C);
  });

  it('T-ADM-08: the detail shows an organizer the emergency contact (v0.6), or null when there is none', async () => {
    expect(obj((await c.call('getParticipant', org, { slug: f.slug, id: f.p.A })).body).participant).toMatchObject({ emergency: null });
    await f.pool.query(`update participants set emergency_name = 'Sam Lee', emergency_phone = '555 0100' where id = $1`, [f.p.A]);
    expect(obj((await c.call('getParticipant', org, { slug: f.slug, id: f.p.A })).body).participant).toMatchObject({
      emergency: { name: 'Sam Lee', phone: '555 0100', relation: null },
    });
    // v0.9: the profile setup answers.
    expect(obj((await c.call('getParticipant', org, { slug: f.slug, id: f.p.A })).body).participant).toMatchObject({
      overnight: null, teamStatus: null, allergies: null, allergySeverity: null, accessibility: null,
    });
    await f.pool.query(`update participants set overnight = 'unsure', team_status = 'looking', allergies = 'Peanuts', allergy_severity = 'severe', accessibility = 'Ramp' where id = $1`, [f.p.A]);
    expect(obj((await c.call('getParticipant', org, { slug: f.slug, id: f.p.A })).body).participant).toMatchObject({
      overnight: 'unsure', teamStatus: 'looking', allergies: 'Peanuts', allergySeverity: 'severe', accessibility: 'Ramp',
    });
  });

  it('I-5: a participant of another event is invisible and untouchable through this event (404)', async () => {
    expect((await c.call('getParticipant', org, { slug: f.slug, id: f.p.X })).status).toBe(404);
    expect((await c.call('deleteParticipant', org, { slug: f.slug, id: f.p.X }, { method: 'DELETE' })).status).toBe(404);
    expect((await c.call('resendPass', org, { slug: f.slug, id: f.p.X }, { method: 'POST' })).status).toBe(404);
    const { rows } = await f.pool.query('select 1 from participants where id = $1 and deleted_at is null', [f.p.X]);
    expect(rows).toHaveLength(1);
  });
});
