import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drainUntilIdle } from '@/lib/email/drain';
import { adminClient } from '../fixtures/admin-api';
import { requireEnv } from '../fixtures/db';
import { mockProvider, serviceClient } from '../fixtures/mail';
import { signInAs } from '../fixtures/staff';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

// SPEC §12 / §11 (v0.12.3, owner's request): the "See you tomorrow" email, queued from the Participants page for
// everyone who said Yes (accepted) and hasn't had it; drained like every other email.
let f: StandardFixture;
let org: string;
const admin = adminClient();
beforeAll(async () => {
  f = await createStandardFixture();
  org = await signInAs(f.staffEmail.org1);
});
afterAll(async () => {
  await f.close();
});

const send = (jwt: string | null, body: unknown) => admin.call('sendEventEve', jwt, { slug: f.slug }, { body });
const rows = async (id: string) =>
  (await f.pool.query<{ status: string }>(`select status from email_outbox where participant_id = $1 and kind = 'event_eve' order by created_at`, [id])).rows.map((r) => r.status);

describe('event-day email (SPEC §12, v0.12.3)', () => {
  it('T-MAIL-18: queued once per accepted hacker (dry run first, ids for a test send), drained without tokens, cancelled for someone who left', async () => {
    const { rows: accepted } = await f.pool.query<{ id: string; email: string }>(
      `select id, email from participants where event_id = $1 and status = 'accepted' and deleted_at is null order by id`,
      [f.e1.id],
    );
    expect(accepted.map((p) => p.id)).toEqual(expect.arrayContaining([f.p.A, f.p.B]));
    for (const id of [f.p.C, f.p.Wd]) expect(accepted.map((p) => p.id)).not.toContain(id);

    const vol = await signInAs(f.staffEmail.vol1);
    expect((await send(vol, {})).status).toBe(403);
    expect((await send(null, {})).status).toBe(401);
    expect((await send(org, { dryRun: true, extra: 1 })).status).toBe(400);
    expect((await send(org, { ids: [] })).status).toBe(400);

    // The dry run counts everyone who said Yes, and writes nothing.
    expect((await send(org, { dryRun: true })).body).toEqual({ count: accepted.length });
    for (const p of accepted) expect(await rows(p.id)).toEqual([]);

    // A test send to chosen people: only the accepted ones among them, never another event's.
    expect((await send(org, { ids: [f.p.A, f.p.C, f.p.Wd, f.p.X] })).body).toEqual({ count: 1 });
    expect(await rows(f.p.A)).toEqual(['pending']);
    for (const id of [f.p.C, f.p.Wd, f.p.X]) expect(await rows(id)).toEqual([]);

    // Everyone else, then nobody: pressing twice never sends twice.
    expect((await send(org, { dryRun: true })).body).toEqual({ count: accepted.length - 1 });
    const before = admin.scheduled.length;
    expect((await send(org, {})).body).toEqual({ count: accepted.length - 1 });
    expect(admin.scheduled.length).toBe(before + 1);
    expect((await send(org, {})).body).toEqual({ count: 0 });
    const audit = await f.pool.query<{ detail: unknown }>(`select detail from audit_log where action = 'email.event_eve' and event_id = $1 order by id`, [f.e1.id]);
    expect(audit.rows.map((r) => r.detail)).toEqual([{ count: 1 }, { count: accepted.length - 1 }, { count: 0 }]);

    // B says No before it goes out: cancelled, not emailed. Everyone else gets exactly one, with no pass or RSVP link.
    await f.pool.query(`update participants set status = 'withdrawn' where id = $1`, [f.p.B]);
    const mail = mockProvider();
    await drainUntilIdle({ db: serviceClient(), provider: mail.provider, appOrigin: 'http://localhost:3100', from: 'Station <p@localhost>', passSecret: requireEnv('PASS_TOKEN_SECRET') });
    expect(await rows(f.p.B)).toEqual(['cancelled']);
    for (const p of accepted.filter((a) => a.id !== f.p.B)) {
      const mine = mail.sent.filter((m) => m.to === p.email);
      expect(mine, p.email).toHaveLength(1);
      expect(mine[0]?.subject).toMatch(/ is tomorrow: check-in details$/);
      expect(mine[0]?.text).toContain('Check-in closes at 10:45 AM');
      expect(`${mine[0]?.html}${mine[0]?.text}`).not.toMatch(/\/p#|\/rsvp#/);
      expect(await rows(p.id)).toEqual(['sent']);
    }
    expect(mail.sent.filter((m) => m.to === accepted.find((a) => a.id === f.p.B)?.email)).toEqual([]);

    // A failed email is queued again by the next press; a sent one never is.
    await f.pool.query(`update email_outbox set status = 'failed' where participant_id = $1 and kind = 'event_eve'`, [f.p.A]);
    expect((await send(org, {})).body).toEqual({ count: 1 });
    expect(await rows(f.p.A)).toEqual(['failed', 'pending']);
  });
});
