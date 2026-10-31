import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/types.gen';
import { sheetDecision, validateRow, type SheetRowInput } from '@/lib/domain/sheet';

type Db = SupabaseClient<Database>;

export const DB_RESULTS = [
  'CREATED',
  'UPDATED',
  'UNCHANGED',
  'PASS_QUEUED',
  'CONFLICT_DUPLICATE_EMAIL',
] as const;
export type IngestResult = (typeof DB_RESULTS)[number] | `INVALID:${string}`;

export interface RowResult {
  external_id: string;
  result: IngestResult;
}

const isDbResult = (v: string): v is (typeof DB_RESULTS)[number] => (DB_RESULTS as readonly string[]).includes(v);

// Rows are independent (SPEC F3): each is its own transaction via ingest_sheet_row(). Results keep
// request order. A few run in parallel so a 500-row paste stays well under 10 s (T-ING-20).
export async function ingestRows(
  db: Db,
  eventId: string,
  rows: SheetRowInput[],
  // sheetStatus (v0.11.27): store the row's Sheet decision. Only Import CSV / Sync now; the Apps Script path doesn't.
  opts: { dryRun: boolean; concurrency?: number; sheetStatus?: boolean },
): Promise<RowResult[]> {
  const results: RowResult[] = new Array<RowResult>(rows.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < rows.length; i = next++) {
      const input = rows[i] ?? {};
      results[i] = { external_id: input.external_id ?? '', result: await ingestOne(db, eventId, input, opts.dryRun, opts.sheetStatus ?? false) };
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 8, rows.length) }, worker));
  return results;
}

async function ingestOne(db: Db, eventId: string, input: SheetRowInput, dryRun: boolean, sheetStatus: boolean): Promise<IngestResult> {
  const v = validateRow(input);
  if (!v.ok) return v.result;
  const { data, error } = await db.rpc('ingest_sheet_row', {
    p_event_id: eventId,
    p_external_id: v.row.externalId,
    p_email: v.row.email,
    p_first_name: v.row.firstName,
    p_last_name: v.row.lastName,
    p_search_text: v.row.searchText,
    p_dietary_notes: v.row.dietaryNotes ?? undefined,
    p_linkedin_url: v.row.linkedinUrl ?? undefined,
    p_dry_run: dryRun,
    p_sheet_status: (sheetStatus && sheetDecision(input.status)) || undefined,
  });
  if (error) throw new Error(`ingest_sheet_row failed (${error.code})`);
  if (!isDbResult(data)) throw new Error('ingest_sheet_row returned an unknown result');
  return data;
}
