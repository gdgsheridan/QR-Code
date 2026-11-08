import { parseCsv } from './csv';
import { normalizeLinkedIn } from './badge';

// SPEC §11 Judges (v0.12.4): a CSV export of the organizers' judge tracker ("Datathon 2026 Outreach": Name, Title @
// Company, LinkedIn, …, Status) or of the judging sheet's Judges tab (Name, Title @ Company, …, Judging?). Pure.
export interface JudgeRow { name: string; title: string | null; linkedinUrl: string | null }
export type JudgeCsv =
  | { ok: true; judges: JudgeRow[]; skipped: number; badLinkedin: number }
  | { ok: false; error: 'missing_name' };

const cell = (row: string[], i: number) => (i >= 0 ? (row[i] ?? '').trim() : '');

export function parseJudgesCsv(text: string): JudgeCsv {
  const rows = parseCsv(text);
  const at = rows.findIndex((r) => r.some((c) => c.trim().toLowerCase() === 'name'));
  if (at < 0) return { ok: false, error: 'missing_name' };
  const head = rows[at]!.map((c) => c.trim().toLowerCase());
  const col = (...names: string[]) => head.findIndex((h) => names.includes(h));
  const name = col('name');
  const title = col('title @ company', 'title');
  const linkedin = col('linkedin', 'linkedin url');
  const status = col('status');     // the tracker: only Confirmed (or Accepted) people judge
  const judging = col('judging?');  // the judging sheet: only Yes
  const seen = new Map<string, JudgeRow>();
  let skipped = 0;
  let badLinkedin = 0;
  for (const row of rows.slice(at + 1)) {
    const who = cell(row, name).replace(/\s+/g, ' ');
    if (!who) continue;
    const s = cell(row, status).toLowerCase();
    if ((status >= 0 && s !== 'confirmed' && s !== 'accepted') || (judging >= 0 && cell(row, judging).toLowerCase() !== 'yes') || who.length > 120) {
      skipped++;
      continue;
    }
    const raw = cell(row, linkedin);
    const url = raw ? normalizeLinkedIn(raw) : null;
    if (raw && !url) badLinkedin++;
    const t = cell(row, title).slice(0, 200);
    seen.set(who.toLowerCase(), { name: who, title: t || null, linkedinUrl: url }); // a name listed twice: the last row wins
  }
  return { ok: true, judges: [...seen.values()], skipped, badLinkedin };
}
