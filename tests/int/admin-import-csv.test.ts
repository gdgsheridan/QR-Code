import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toCsv } from '@/lib/domain/csv';
import { adminClient } from '../fixtures/admin-api';
import { sheetRow } from '../fixtures/ingest';
import { signInAs } from '../fixtures/staff';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

let f: StandardFixture;
let org: string;
// No Sheets API at all: the CSV must be enough.
const c = adminClient();
beforeAll(async () => {
  f = await createStandardFixture();
  org = await signInAs(f.staffEmail.org1);
});
afterAll(async () => {
  await f.close();
});

describe('Import CSV (SPEC F10, v0.11.22) through the admin API', () => {
  it('T-ING-28: an uploaded CSV export imports without a linked Sheet: dry run first, then apply; pending, nobody emailed', async () => {
    const a = sheetRow(f.slug, { first_name: 'Csvia' });
    const b = sheetRow(f.slug, { first_name: 'Quinn' });
    const csv = toCsv(
      ['Timestamp', 'First Name', 'Last Name', 'Email Address', 'Applicant ID', 'Status', 'Sync Status'],
      [
        ['2026-10-01 09:00', a.first_name, 'O’Brien, "Jr"', ` ${a.email.toUpperCase()} `, a.external_id, 'Accepted', ''],
        ['2026-10-01 09:05', b.first_name, '', b.email, b.external_id, '', ''],
        ['2026-10-01 09:10', 'Nomail', '', '', `${b.external_id}-x`, '', ''],
      ],
    );
    const count = async () =>
      (await f.pool.query<{ n: number }>('select count(*)::int as n from participants where event_id = $1', [f.e1.id])).rows[0]?.n;
    const before = await count();
    const dry = await c.call('syncSheet', org, { slug: f.slug }, { body: { dryRun: true, csv } });
    expect(dry.status).toBe(200);
    expect(dry.body).toMatchObject({ dryRun: true, total: 3, skipped: 0, counts: { CREATED: 2, 'INVALID:email': 1 } });
    expect(await count()).toBe(before);

    const applied = await c.call('syncSheet', org, { slug: f.slug }, { body: { dryRun: false, csv } });
    expect(applied.body).toMatchObject({ dryRun: false, counts: { CREATED: 2, 'INVALID:email': 1 } });
    const { rows } = await f.pool.query<{ email: string; last_name: string; status: string; source: string }>(
      'select email, last_name, status, source from participants where event_id = $1 and external_id = any($2) order by first_name',
      [f.e1.id, [a.external_id, b.external_id]],
    );
    expect(rows).toEqual([
      { email: a.email.toLowerCase(), last_name: 'O’Brien, "Jr"', status: 'pending', source: 'sheet' },
      { email: b.email, last_name: '', status: 'pending', source: 'sheet' },
    ]);
    expect(c.scheduled.length).toBe(0);
    const audit = await f.pool.query<{ actor_kind: string; detail: unknown }>(`select actor_kind, detail from audit_log where action = 'sheet.sync' and event_id = $1`, [f.e1.id]);
    expect(audit.rows).toEqual([{ actor_kind: 'staff', detail: { total: 3, skipped: 0, counts: { CREATED: 2, 'INVALID:email': 1 } } }]);
    expect((await c.call('syncSheet', org, { slug: f.slug }, { body: { dryRun: true, csv } })).body).toMatchObject({ counts: { UNCHANGED: 2 } });
  });

  it.each([
    { statuses: ['accepted'], selected: [0], skipped: 4 },
    { statuses: ['accepted', 'waitlisted'], selected: [0, 1, 2], skipped: 2 },
  ])('T-ING-28: Status filter $statuses previews and imports only matching applicants as pending', async ({ statuses, selected, skipped }) => {
    const applicants = ['Accepted', ' waitlisted ', 'Waitlist', 'Rejected', ''].map((status) => sheetRow(f.slug, { status }));
    const csv = toCsv(
      ['Applicant ID', 'Email Address', 'First Name', 'Status'],
      applicants.map((r) => [r.external_id, r.email, r.first_name, r.status]),
    );
    const imported = async () => (await f.pool.query<{ external_id: string; status: string }>(
      'select external_id, status from participants where event_id = $1 and external_id = any($2) order by external_id',
      [f.e1.id, applicants.map((r) => r.external_id)],
    )).rows;
    const report = { total: selected.length, skipped, counts: { CREATED: selected.length } };
    const dry = await c.call('syncSheet', org, { slug: f.slug }, { body: { dryRun: true, csv, statuses } });
    expect(dry.status).toBe(200);
    expect(dry.body).toMatchObject({ dryRun: true, ...report });
    expect(await imported()).toEqual([]);
    const applied = await c.call('syncSheet', org, { slug: f.slug }, { body: { dryRun: false, csv, statuses } });
    expect(applied.status).toBe(200);
    expect(applied.body).toMatchObject({ dryRun: false, ...report });
    expect(await imported()).toEqual(selected.map((i) => ({ external_id: applicants[i]!.external_id, status: 'pending' })).sort((a, b) => a.external_id.localeCompare(b.external_id)));
    expect(c.scheduled).toHaveLength(0);
    const audit = await f.pool.query<{ detail: unknown }>(
      `select detail from audit_log where action = 'sheet.sync' and event_id = $1 order by created_at desc limit 1`, [f.e1.id],
    );
    expect(audit.rows).toEqual([{ detail: { total: report.total, skipped, counts: report.counts } }]);
  });

  it('T-ING-28: a Status filter requires the Status header; an empty selection imports all rows', async () => {
    const r = sheetRow(f.slug);
    const csv = toCsv(['Applicant ID', 'Email Address', 'First Name'], [[r.external_id, r.email, r.first_name]]);
    for (const dryRun of [true, false]) {
      const res = await c.call('syncSheet', org, { slug: f.slug }, { body: { dryRun, csv, statuses: ['accepted'] } });
      expect(res.status).toBe(422);
      expect(res.body).toEqual({ error: 'BAD_SHEET', message: 'Missing header: Status' });
    }
    const all = await c.call('syncSheet', org, { slug: f.slug }, { body: { dryRun: true, csv, statuses: [] } });
    expect(all.status).toBe(200);
    expect(all.body).toMatchObject({ total: 1, skipped: 0, counts: { CREATED: 1 } });
  });

  it('T-ING-28: unsupported statuses and more than two selections are 400', async () => {
    for (const statuses of [['rejected'], ['accepted', 'waitlisted', 'accepted']]) {
      expect((await c.call('syncSheet', org, { slug: f.slug }, { body: { dryRun: true, csv: '', statuses } })).status).toBe(400);
    }
  });

  it('T-ING-28: a CSV without the Email Address column is 422 naming it; a bad body is 400', async () => {
    const res = await c.call('syncSheet', org, { slug: f.slug }, { body: { dryRun: true, csv: 'Applicant ID,First Name\nid-x,X\n' } });
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: 'BAD_SHEET', message: 'Missing header: Email Address' });
    expect((await c.call('syncSheet', org, { slug: f.slug }, { body: { dryRun: true, csv: 42 } })).status).toBe(400);
    expect((await c.call('syncSheet', org, { slug: f.slug }, { body: { dryRun: true, csv: '', extra: 1 } })).status).toBe(400);
  });

  it('T-ING-28: the organizers\' Sheet as exported (v0.11.25): STATUS Yes/Waitlist, no Applicant ID, LinkedIn; keyed by email', async () => {
    const [yes, wait, deny] = ['Yes', 'Waitlist', 'Deny'].map((status) => sheetRow(f.slug, { first_name: `Sheet${status}`, status }));
    const csv = toCsv(
      ['STATUS', 'Timestamp', 'Email Address', 'First Name', 'Last Name', 'LinkedIn', 'Notes'],
      [yes!, wait!, deny!].map((r) => [r.status, '10/5/2026 8:53:12', ` ${r.email.toUpperCase()} `, r.first_name, 'Sheet', 'https://www.linkedin.com/in/sheet-person', '']),
    );
    const body = { dryRun: false, csv, statuses: ['accepted', 'waitlisted'] };
    expect((await c.call('syncSheet', org, { slug: f.slug }, { body })).body).toMatchObject({ total: 2, skipped: 1, counts: { CREATED: 2 } });
    const { rows } = await f.pool.query<{ external_id: string; email: string; status: string; linkedin_url: string }>(
      'select external_id, email, status, linkedin_url from participants where event_id = $1 and first_name like $2 order by first_name',
      [f.e1.id, 'Sheet%'],
    );
    expect(rows).toEqual([wait!, yes!].map((r) => ({ external_id: r.email.toLowerCase(), email: r.email.toLowerCase(), status: 'pending', linkedin_url: 'https://www.linkedin.com/in/sheet-person' })));
    expect((await c.call('syncSheet', org, { slug: f.slug }, { body: { ...body, dryRun: true } })).body).toMatchObject({ counts: { UNCHANGED: 2 } });

    // v0.11.26: the Sheet's decision is kept apart from their status, listed, and filterable.
    const listed = async (sheet?: string) => {
      const res = await c.call('listParticipants', org, { slug: f.slug }, { query: { q: 'sheet', ...(sheet && { sheet }) } });
      return (res.body as { participants: Array<{ firstName: string; status: string; sheetStatus: string | null }> }).participants
        .filter((p) => p.firstName.startsWith('Sheet')).map((p) => [p.firstName, p.status, p.sheetStatus]);
    };
    expect(await listed()).toEqual([['SheetWaitlist', 'pending', 'waitlisted'], ['SheetYes', 'pending', 'accepted']]);
    expect(await listed('accepted')).toEqual([['SheetYes', 'pending', 'accepted']]);
    expect(await listed('waitlisted')).toEqual([['SheetWaitlist', 'pending', 'waitlisted']]);
    expect((await c.call('listParticipants', org, { slug: f.slug }, { query: { sheet: 'rejected' } })).status).toBe(400);
    // Moved off the waitlist in the Sheet: UPDATED, still pending; a Status the filter skips leaves it as it was.
    const moved = csv.replace('"Waitlist"', '"Yes"');
    expect((await c.call('syncSheet', org, { slug: f.slug }, { body: { ...body, csv: moved } })).body).toMatchObject({ counts: { UPDATED: 1, UNCHANGED: 1 } });
    expect(await listed('waitlisted')).toEqual([]);
    // Unfiltered, the Yes person now marked Deny keeps their decision; the Deny applicant comes in with none.
    expect((await c.call('syncSheet', org, { slug: f.slug }, { body: { dryRun: false, csv: moved.replace('"Yes"', '"Deny"') } })).body).toMatchObject({ counts: { UNCHANGED: 2, CREATED: 1 } });
    expect(await listed('accepted')).toEqual([['SheetWaitlist', 'pending', 'accepted'], ['SheetYes', 'pending', 'accepted']]);
  });
});
