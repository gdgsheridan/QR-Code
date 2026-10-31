import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminClient, obj } from '../fixtures/admin-api';
import { sheetRow } from '../fixtures/ingest';
import { signInAs } from '../fixtures/staff';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

let f: StandardFixture;
let org: string;
let requestedSheet: string | null = null;
const header = ['Email Address', 'First Name', 'Applicant ID', 'Status'];
let sheet: string[][] = [header];
const c = adminClient({
  sheetReader: (sheetId) => {
    requestedSheet = sheetId;
    return async () => sheet;
  },
});
beforeAll(async () => {
  f = await createStandardFixture();
  org = await signInAs(f.staffEmail.org1);
});
afterAll(async () => {
  await f.close();
});

describe('Sync now (SPEC F10) through the admin API', () => {
  it('F10: without a linked Sheet the sync is 409 NOT_CONFIGURED', async () => {
    const res = await c.call('syncSheet', org, { slug: f.slug }, { body: { dryRun: true } });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'NOT_CONFIGURED' });
  });

  it('T-ING-25 (route): link a Sheet by URL, dry-run shows the diff without writing, apply writes and sends no email', async () => {
    const link = await c.call('updateEvent', org, { slug: f.slug }, {
      method: 'PATCH',
      body: { sheet: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=0' },
    });
    expect(link.status).toBe(200);
    expect(obj(link.body).sheetId).toBe('1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789');

    const r = sheetRow(f.slug, { first_name: 'Newcomer' });
    sheet = [header, [r.email, r.first_name, r.external_id, 'Accepted']];
    const before = await f.pool.query<{ n: number }>('select count(*)::int as n from participants where event_id = $1', [f.e1.id]);
    const dry = await c.call('syncSheet', org, { slug: f.slug }, { body: { dryRun: true } });
    expect(requestedSheet).toBe('1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789');
    expect(dry.body).toMatchObject({ dryRun: true, total: 1, counts: { CREATED: 1 } });
    const mid = await f.pool.query<{ n: number }>('select count(*)::int as n from participants where event_id = $1', [f.e1.id]);
    expect(mid.rows[0]?.n).toBe(before.rows[0]?.n);

    const applied = await c.call('syncSheet', org, { slug: f.slug }, { body: { dryRun: false } });
    expect(applied.body).toMatchObject({ dryRun: false, counts: { CREATED: 1 } });
    // v0.4: importing never emails anyone; organizers send RSVPs (F13).
    expect(c.scheduled.length).toBe(0);
    const { rows } = await f.pool.query<{ actor_kind: string }>(`select actor_kind from audit_log where action = 'sheet.sync' and event_id = $1`, [f.e1.id]);
    expect(rows).toEqual([{ actor_kind: 'staff' }]);
  });

  it('T-ING-28: the Sheets API path uses the same Status filter and requires its header', async () => {
    const accepted = sheetRow(f.slug);
    const waitlisted = sheetRow(f.slug, { status: 'Waitlist' });
    sheet = [header, ...[accepted, waitlisted].map((r) => [r.email, r.first_name, r.external_id, r.status])];
    const res = await c.call('syncSheet', org, { slug: f.slug }, { body: { dryRun: true, statuses: ['accepted'] } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 1, skipped: 1, counts: { CREATED: 1 } });
    sheet = sheet.map((row) => row.slice(0, 3));
    const missing = await c.call('syncSheet', org, { slug: f.slug }, { body: { dryRun: true, statuses: ['waitlisted'] } });
    expect(missing.status).toBe(422);
    expect(missing.body).toEqual({ error: 'BAD_SHEET', message: 'Missing header: Status' });
  });

  it('F10 / §11: the event reports the last applied sync time (dry runs do not count)', async () => {
    const { rows } = await f.pool.query<{ at: Date }>(`select max(created_at) as at from audit_log where action = 'sheet.sync' and event_id = $1`, [f.e1.id]);
    const res = await c.call('getEvent', org, { slug: f.slug });
    expect(obj(res.body).lastSyncAt).toBe(rows[0]?.at.toISOString());
    await c.call('syncSheet', org, { slug: f.slug }, { body: { dryRun: true } });
    expect(obj((await c.call('getEvent', org, { slug: f.slug })).body).lastSyncAt).toBe(rows[0]?.at.toISOString());
  });

  it('F10: an invalid Sheet link is 400', async () => {
    expect((await c.call('updateEvent', org, { slug: f.slug }, { method: 'PATCH', body: { sheet: 'not a sheet' } })).status).toBe(400);
  });
});

describe('event info for hackers (SPEC §11 Info, v0.6)', () => {
  const patch = (body: unknown) => c.call('updateEvent', org, { slug: f.slug }, { method: 'PATCH', body });

  it('T-ADM-08: organizers save the schedule and emergency info; over-long text and an empty body are refused', async () => {
    const info = { schedule: 'Doors 9:00\nLunch 12:00', emergencyInfo: 'Call Ade: 555-0100' };
    const res = await patch(info);
    expect(res).toMatchObject({ status: 200, body: info });
    expect((await c.call('getEvent', org, { slug: f.slug })).body).toMatchObject(info);

    // One field at a time leaves the other alone.
    expect((await patch({ schedule: '' })).status).toBe(200);
    expect((await c.call('getEvent', org, { slug: f.slug })).body).toMatchObject({ schedule: '', emergencyInfo: info.emergencyInfo });

    for (const body of [{ schedule: 's'.repeat(5001) }, { emergencyInfo: 'e'.repeat(2001) }, {}, { schedule: 1 }, { schedule: '', extra: 1 }]) {
      expect((await patch(body)).status, JSON.stringify(body).slice(0, 40)).toBe(400);
    }
    expect((await patch({ schedule: 's'.repeat(5000), emergencyInfo: 'e'.repeat(2000) })).status).toBe(200);
    // The Sheet link still answers as before.
    expect((await patch({ sheet: null })).body).toEqual({ sheetId: null });

    const { rows } = await f.pool.query<{ detail: unknown }>(`select detail from audit_log where action = 'event.info' and event_id = $1`, [f.e1.id]);
    expect(rows).toEqual([{ detail: {} }, { detail: {} }, { detail: {} }]);
  });

  it('T-ADM-08: organizers set or clear the RSVP deadline (v0.9); anything but a future ISO instant is refused', async () => {
    const at = new Date(Date.now() + 10 * 86_400_000).toISOString();
    expect(await patch({ rsvpDeadline: at })).toMatchObject({ status: 200, body: { rsvpDeadline: at } });
    expect((await c.call('getEvent', org, { slug: f.slug })).body).toMatchObject({ rsvpDeadline: at });
    // A deadline in the past would turn every unanswered invite into a no at once.
    for (const rsvpDeadline of ['tomorrow', '2026-11-03', 5, '', new Date(Date.now() - 60_000).toISOString()]) {
      expect((await patch({ rsvpDeadline })).status, String(rsvpDeadline)).toBe(400);
    }
    expect((await c.call('getEvent', org, { slug: f.slug })).body).toMatchObject({ rsvpDeadline: at });
    expect((await patch({ rsvpDeadline: null })).body).toEqual({ rsvpDeadline: null });
    expect((await c.call('getEvent', org, { slug: f.slug })).body).toMatchObject({ rsvpDeadline: null });
  });

  it('T-ADM-08: the reply-by date (v0.11.27) is set and cleared like the deadline, and never after it', async () => {
    const day = 86_400_000;
    const [replyBy, closes] = [Date.now() + 4 * day, Date.now() + 8 * day].map((t) => new Date(t).toISOString());
    expect(await patch({ rsvpReplyBy: replyBy, rsvpDeadline: closes })).toMatchObject({ status: 200, body: { rsvpReplyBy: replyBy, rsvpDeadline: closes } });
    expect((await c.call('getEvent', org, { slug: f.slug })).body).toMatchObject({ rsvpReplyBy: replyBy, rsvpDeadline: closes });
    // After the close, or a close moved before it: refused, nothing changed.
    expect((await patch({ rsvpReplyBy: new Date(Date.now() + 9 * day).toISOString() })).status).toBe(400);
    expect((await patch({ rsvpDeadline: new Date(Date.now() + 2 * day).toISOString() })).status).toBe(400);
    expect((await patch({ rsvpReplyBy: new Date(Date.now() - 60_000).toISOString() })).status).toBe(400);
    expect((await c.call('getEvent', org, { slug: f.slug })).body).toMatchObject({ rsvpReplyBy: replyBy, rsvpDeadline: closes });
    expect((await patch({ rsvpReplyBy: null, rsvpDeadline: null })).body).toEqual({ rsvpReplyBy: null, rsvpDeadline: null });
  });
});
