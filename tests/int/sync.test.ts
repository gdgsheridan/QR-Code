import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { syncSheet } from '@/lib/ingest/sync';
import { ingestClient, sheetRow } from '../fixtures/ingest';
import { serviceClient } from '../fixtures/mail';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

let f: StandardFixture;
beforeAll(async () => {
  f = await createStandardFixture();
});
afterAll(async () => {
  await f.close();
});

async function allTableCounts(): Promise<Record<string, number>> {
  const { rows: tables } = await f.pool.query<{ tablename: string }>(`select tablename from pg_tables where schemaname = 'public'`);
  const out: Record<string, number> = {};
  for (const { tablename } of tables) {
    const { rows } = await f.pool.query<{ n: number }>(`select count(*)::int as n from public.${JSON.stringify(tablename)}`);
    out[tablename] = rows[0]?.n ?? -1;
  }
  return out;
}

describe('Sync now (SPEC F10)', () => {
  it('T-ING-25: dry run returns the diff and writes nothing; apply produces the same results', async () => {
    const c = ingestClient();
    const existing = sheetRow(f.slug);
    const renamed = sheetRow(f.slug);
    await c.ingest(f.slug, [existing, renamed]);

    const newcomer = sheetRow(f.slug, { first_name: 'Zoë' });
    const header = ['Timestamp', 'Email Address', 'First Name', 'Last Name', 'Dietary Restrictions', 'LinkedIn URL', 'Applicant ID', 'Status', 'Sync Status'];
    const asCells = (r: ReturnType<typeof sheetRow>) => ['1/1', r.email, r.first_name, r.last_name, r.dietary_notes, r.linkedin_url, r.external_id, r.status, ''];
    const sheet = [header, asCells(existing), asCells({ ...renamed, first_name: 'Renamed', status: 'Withdrawn' }), asCells(newcomer), ['1/2', '', 'Nobody', '', '', '', 'id-x', '', '']];
    const readSheet = async () => sheet;

    const before = await allTableCounts();
    const dry = await syncSheet(serviceClient(), f.e1.id, { dryRun: true, readSheet });
    expect(await allTableCounts()).toEqual(before);
    expect(dry).toEqual({
      dryRun: true,
      total: 4,
      skipped: 0,
      // v0.4: Status never changes anyone's status (Withdrawn changes nothing). v0.11.27: Sync records the Sheet's
      // decision, so `existing` (Accepted; the Apps Script path stored none) is an update too.
      counts: { UPDATED: 2, CREATED: 1, 'INVALID:email': 1 },
      changes: [
        { external_id: existing.external_id, result: 'UPDATED' },
        { external_id: renamed.external_id, result: 'UPDATED' },
        { external_id: newcomer.external_id, result: 'CREATED' },
        { external_id: 'id-x', result: 'INVALID:email' },
      ],
    });

    const applied = await syncSheet(serviceClient(), f.e1.id, { dryRun: false, readSheet, actorUserId: f.staff.org1 });
    expect({ ...applied, dryRun: true }).toEqual(dry);
    const { rows } = await f.pool.query<{ detail: unknown; actor_kind: string }>(
      `select detail, actor_kind from audit_log where action = 'sheet.sync' and event_id = $1`,
      [f.e1.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor_kind).toBe('staff');
    expect(JSON.stringify(rows[0]?.detail)).not.toMatch(/@|Zoë|Row/);

    const again = await syncSheet(serviceClient(), f.e1.id, { dryRun: true, readSheet });
    expect(again.changes).toEqual([{ external_id: 'id-x', result: 'INVALID:email' }]);
    const { rows: people } = await f.pool.query<{ status: string; sheet_status: string | null }>(
      'select status, sheet_status from participants where event_id = $1 and external_id = any($2) order by external_id = $3 desc',
      [f.e1.id, [existing.external_id, renamed.external_id], existing.external_id],
    );
    expect(people).toEqual([{ status: 'pending', sheet_status: 'accepted' }, { status: 'pending', sheet_status: null }]);
  });
});
