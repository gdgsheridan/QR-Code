import { describe, expect, it } from 'vitest';
import { filterSheetValues, mapSheetValues, sheetDecision } from '@/lib/domain/sheet';

const values = [
  ['Applicant ID', 'Email Address', 'First Name', ' Status '],
  ...[' ACCEPTED ', ' waitlisted ', 'Waitlist', 'Rejected', ''].map((status, i) => [String(i), `${i}@example.test`, 'Applicant', status]),
  ['', '', '', ''],
];

describe('CSV and Sheet Status filtering (SPEC F10)', () => {
  it('T-ING-28: filters normalized Status values, including waitlist, and counts skipped nonblank rows', () => {
    const rows = mapSheetValues(values);
    expect(filterSheetValues(values, ['accepted'])).toEqual({ rows: rows.slice(0, 1), skipped: 4 });
    expect(filterSheetValues(values, ['accepted', 'waitlisted'])).toEqual({ rows: rows.slice(0, 3), skipped: 2 });
    expect(filterSheetValues(values, ['waitlisted'])).toEqual({ rows: rows.slice(1, 3), skipped: 3 });
  });

  it('T-ING-28: only a nonempty filter requires a Status header; no selection keeps every row', () => {
    const noStatus = values.map((row) => row.slice(0, 3));
    expect(() => filterSheetValues(noStatus, ['accepted'])).toThrow('Missing header: Status');
    expect(() => filterSheetValues([], ['accepted'])).toThrow('Missing header: Status');
    for (const statuses of [undefined, []]) {
      expect(filterSheetValues(noStatus, statuses)).toEqual({ rows: mapSheetValues(noStatus), skipped: 0 });
      expect(filterSheetValues(values, statuses)).toEqual({ rows: mapSheetValues(values), skipped: 0 });
    }
    expect(filterSheetValues([values[0]!], ['accepted'])).toEqual({ rows: [], skipped: 0 });
    expect(filterSheetValues([values[0]!, values[4]!], ['accepted'])).toEqual({ rows: [], skipped: 1 });
  });

  it('T-ING-28: filtering finds reordered headers without changing the source cells or bypassing required headers', () => {
    const reordered = values.map((row) => [...row].reverse());
    const before = structuredClone(reordered);
    expect(filterSheetValues(reordered, ['accepted'])).toEqual({ rows: mapSheetValues(values).slice(0, 1), skipped: 4 });
    expect(reordered).toEqual(before);
    expect(() => filterSheetValues([['Status'], ['Rejected']], ['accepted'])).toThrow('Missing header: Email Address');
  });

  it('T-ING-28: the organizers\' Sheet (v0.11.26): a STATUS header, Yes as accepted, Waitlist as waitlisted, everything else skipped', () => {
    const sheet = [
      ['STATUS', 'Email Address', 'First Name'],
      ...['Yes', ' yes ', 'Waitlist', 'Deny', 'Duplicate', 'Test', ''].map((status, i) => [status, `${i}@example.test`, 'Applicant']),
    ];
    const rows = mapSheetValues(sheet);
    expect(filterSheetValues(sheet, ['accepted', 'waitlisted'])).toEqual({ rows: rows.slice(0, 3), skipped: 4 });
    expect(filterSheetValues(sheet, ['accepted'])).toEqual({ rows: rows.slice(0, 2), skipped: 5 });
    expect(['Yes', ' ACCEPTED ', 'Waitlist', 'waitlisted', 'Deny', 'Duplicate', '', undefined].map(sheetDecision))
      .toEqual(['accepted', 'accepted', 'waitlisted', 'waitlisted', null, null, null, null]);
  });
});
