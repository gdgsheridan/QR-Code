import { normalizeEmail, toSearchText } from './normalize';

// SPEC F3 / §9.2 / Appendix A. Pure row handling for the Sheet bridge.

export interface SheetRowInput {
  external_id?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  dietary_notes?: string;
  linkedin_url?: string;
  /** Never sets participant status (v0.4); optionally filters imports (v0.11.22). */
  status?: string;
}

export interface CleanRow {
  externalId: string;
  email: string;
  firstName: string;
  lastName: string;
  searchText: string;
  dietaryNotes: string | null;
  linkedinUrl: string | null;
}

export type RowValidation = { ok: true; row: CleanRow } | { ok: false; result: `INVALID:${string}` };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Same pattern as the participants.linkedin_url check constraint (§5).
const LINKEDIN = /^https:\/\/(www\.)?linkedin\.com\/in\/[A-Za-z0-9_%-]+\/?$/;

// Postgres length() counts characters (code points), not UTF-16 units.
const chars = (s: string) => [...s].length;

export function validateRow(input: SheetRowInput): RowValidation {
  const externalId = (input.external_id ?? '').trim();
  const email = normalizeEmail(input.email ?? '');
  const firstName = (input.first_name ?? '').trim();
  const lastName = (input.last_name ?? '').trim();
  const dietary = (input.dietary_notes ?? '').trim();
  const linkedin = (input.linkedin_url ?? '').trim();

  const bad: string[] = [];
  if (externalId === '' || chars(externalId) > 200) bad.push('external_id');
  if (!EMAIL.test(email) || chars(email) > 320) bad.push('email');
  if (chars(firstName) < 1 || chars(firstName) > 100) bad.push('first_name');
  if (chars(lastName) > 100) bad.push('last_name');
  if (chars(dietary) > 500) bad.push('dietary_notes');
  if (bad.length > 0) return { ok: false, result: `INVALID:${bad.join(',')}` };

  return {
    ok: true,
    row: {
      externalId,
      email,
      firstName,
      lastName,
      searchText: toSearchText(`${firstName} ${lastName}`),
      dietaryNotes: dietary === '' ? null : dietary,
      // DECISION §9.2: an invalid LinkedIn URL is dropped, not an INVALID row.
      linkedinUrl: LINKEDIN.test(linkedin) ? linkedin : null,
    },
  };
}

// Appendix A: the form's response tab and header names.
export const SHEET_TAB = 'Form Responses 1';

// Appendix A header names, matched ignoring case and outer spaces. Rows are found by header, never by column
// position (T-GAS-07).
export const SHEET_HEADERS = {
  external_id: 'Applicant ID',
  email: 'Email Address',
  first_name: 'First Name',
  last_name: 'Last Name',
  dietary_notes: 'Dietary Restrictions',
  linkedin_url: 'LinkedIn URL',
  status: 'Status',
} as const satisfies Record<keyof SheetRowInput, string>;

// v0.11.26: the organizers' applications Sheet heads its LinkedIn column "LinkedIn".
const ALIASES: Partial<Record<keyof SheetRowInput, string[]>> = { linkedin_url: ['LinkedIn'] };

const REQUIRED: Array<keyof SheetRowInput> = ['email', 'first_name'];

export function mapSheetValues(values: string[][]): Array<Required<SheetRowInput>> {
  const [header = [], ...data] = values;
  const index = new Map(header.map((h, i) => [String(h).trim().toLowerCase(), i]));
  const keys = Object.keys(SHEET_HEADERS) as Array<keyof SheetRowInput>;
  const column = new Map(keys.map((k) => [k, [SHEET_HEADERS[k], ...(ALIASES[k] ?? [])].map((h) => index.get(h.toLowerCase())).find((i) => i !== undefined)]));
  for (const key of REQUIRED) {
    if (column.get(key) === undefined) throw new Error(`Missing header: ${SHEET_HEADERS[key]}`);
  }
  // v0.11.26 (owner's decision, relaxes I-14): an export without an Applicant ID column is keyed by its email.
  const byEmail = column.get('external_id') === undefined;
  const cell = (row: string[], key: keyof SheetRowInput) => {
    const i = column.get(key);
    return i === undefined ? '' : String(row[i] ?? '').trim();
  };
  return data
    .map((row) => {
      const r = Object.fromEntries(keys.map((k) => [k, cell(row, k)])) as Required<SheetRowInput>;
      return byEmail ? { ...r, external_id: normalizeEmail(r.email) } : r;
    })
    .filter((r) => keys.some((k) => r[k] !== ''));
}

export type SheetStatus = 'accepted' | 'waitlisted';

// The Sheet's own words: organizers mark accepted applicants "Yes" and waitlisted ones "Waitlist".
const STATUS_WORDS: Record<string, SheetStatus> = { accepted: 'accepted', yes: 'accepted', waitlisted: 'waitlisted', waitlist: 'waitlisted' };

/** What a Sheet Status cell decided, or null for anything else (Deny, Duplicate, blank…). */
export const sheetDecision = (status: string | undefined): SheetStatus | null => STATUS_WORDS[(status ?? '').trim().toLowerCase()] ?? null;

export function filterSheetValues(values: string[][], statuses?: SheetStatus[]) {
  const status = SHEET_HEADERS.status.toLowerCase();
  if (statuses?.length && !values[0]?.some((header) => header.trim().toLowerCase() === status)) throw new Error(`Missing header: ${SHEET_HEADERS.status}`);
  const rows = mapSheetValues(values);
  if (!statuses?.length) return { rows, skipped: 0 };
  const selected = rows.filter((row) => {
    const decision = sheetDecision(row.status);
    return decision !== null && statuses.includes(decision);
  });
  return { rows: selected, skipped: rows.length - selected.length };
}

// F10: organizers paste either the Sheet's id or its docs.google.com URL.
const SHEET_ID = /^[A-Za-z0-9_-]{20,100}$/;
const SHEET_URL = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,100})(?:[/?#].*)?$/;

export function parseSheetId(input: string): string | null {
  const s = input.trim();
  if (SHEET_ID.test(s)) return s;
  return SHEET_URL.exec(s)?.[1] ?? null;
}
