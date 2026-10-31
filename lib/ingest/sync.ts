import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/types.gen';
import { filterSheetValues, SHEET_TAB, type SheetStatus } from '@/lib/domain/sheet';
import { parseServiceAccount, readSheetValues } from '@/lib/sheets/google';
import { ingestRows, type RowResult } from './rows';

// SPEC F10 "Sync now": read the whole Sheet and run the SAME upsert as F3, dry run first.

export interface SyncReport {
  dryRun: boolean;
  total: number;
  skipped: number;
  counts: Record<string, number>;
  /** Rows that would change (or did): external id + result only. */
  changes: RowResult[];
}

export async function syncSheet(
  db: SupabaseClient<Database>,
  eventId: string,
  opts: { dryRun: boolean; readSheet: () => Promise<string[][]>; actorUserId?: string; statuses?: SheetStatus[] },
): Promise<SyncReport> {
  const { rows, skipped } = filterSheetValues(await opts.readSheet(), opts.statuses);
  const results = await ingestRows(db, eventId, rows, { dryRun: opts.dryRun, sheetStatus: true });
  const counts: Record<string, number> = {};
  for (const r of results) counts[r.result] = (counts[r.result] ?? 0) + 1;
  const report: SyncReport = {
    dryRun: opts.dryRun,
    total: results.length,
    skipped,
    counts,
    changes: results.filter((r) => r.result !== 'UNCHANGED'),
  };
  if (!opts.dryRun) {
    // Counts only (I-11).
    const { error } = await db.from('audit_log').insert({
      event_id: eventId,
      actor_user_id: opts.actorUserId ?? null,
      actor_kind: opts.actorUserId ? 'staff' : 'system',
      action: 'sheet.sync',
      detail: { total: report.total, skipped, counts },
    });
    if (error) throw new Error(`audit_log insert failed (${error.code})`);
  }
  return report;
}

export function googleSheetReader(sheetId: string, serviceAccountJson: string): () => Promise<string[][]> {
  const serviceAccount = parseServiceAccount(serviceAccountJson);
  return () => readSheetValues({ sheetId, tab: SHEET_TAB, serviceAccount });
}
