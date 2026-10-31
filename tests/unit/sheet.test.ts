import { describe, expect, it } from 'vitest';
import { mapSheetValues, validateRow } from '@/lib/domain/sheet';

const good = {
  external_id: 'a1',
  email: 'ada@example.com',
  first_name: 'Ada',
  last_name: 'Lovelace',
  dietary_notes: '',
  linkedin_url: '',
  status: 'Accepted',
};

describe('sheet rows (SPEC F3, §9.2)', () => {
  it('T-ING-17 (v0.4): the Status column is ignored: any value, blank or missing gives the same valid row', () => {
    const rows = ['Accepted', 'Maybe', '', undefined].map((status) => validateRow({ ...good, status }));
    for (const r of rows) expect(r).toEqual(rows[0]);
    expect(rows[0]).toMatchObject({ ok: true });
  });

  it('T-ING-16: missing email / first_name / external_id are INVALID, listing every bad field', () => {
    expect(validateRow({ ...good, email: '' })).toEqual({ ok: false, result: 'INVALID:email' });
    expect(validateRow({ ...good, first_name: '  ' })).toEqual({ ok: false, result: 'INVALID:first_name' });
    expect(validateRow({ ...good, external_id: undefined })).toEqual({ ok: false, result: 'INVALID:external_id' });
    expect(validateRow({ status: 'bogus' })).toEqual({ ok: false, result: 'INVALID:external_id,email,first_name' });
    expect(validateRow({ ...good, email: 'not-an-email' })).toEqual({ ok: false, result: 'INVALID:email' });
  });

  it('T-ING-12: the clean row has a normalized email and search_text', () => {
    const r = validateRow({ ...good, email: ' Ade@Gmail.COM ', first_name: 'Zoë', last_name: "O'Brien" });
    expect(r).toMatchObject({ ok: true, row: { email: 'ade@gmail.com', searchText: 'zoe o brien' } });
  });

  it('T-ING-22: a 100-char first name is fine; 101 chars is INVALID:first_name; markup is kept verbatim', () => {
    expect(validateRow({ ...good, first_name: 'x'.repeat(100) }).ok).toBe(true);
    expect(validateRow({ ...good, first_name: 'x'.repeat(101) })).toEqual({ ok: false, result: 'INVALID:first_name' });
    expect(validateRow({ ...good, first_name: '<script>alert(1)</script>' })).toMatchObject({
      ok: true,
      row: { firstName: '<script>alert(1)</script>' },
    });
    expect(validateRow({ ...good, last_name: 'y'.repeat(101) })).toEqual({ ok: false, result: 'INVALID:last_name' });
    expect(validateRow({ ...good, dietary_notes: 'z'.repeat(501) })).toEqual({ ok: false, result: 'INVALID:dietary_notes' });
  });

  it('T-ING-23: an invalid linkedin_url is dropped to null without making the row invalid', () => {
    for (const bad of ['linkedin.com/company/x', 'https://www.linkedin.com/company/x', 'javascript:alert(1)']) {
      expect(validateRow({ ...good, linkedin_url: bad })).toMatchObject({ ok: true, row: { linkedinUrl: null } });
    }
    expect(validateRow({ ...good, linkedin_url: ' https://www.linkedin.com/in/ada-l/ ' })).toMatchObject({
      ok: true,
      row: { linkedinUrl: 'https://www.linkedin.com/in/ada-l/' },
    });
  });

  it('T-ING-16: blank optional fields become null/empty, not INVALID', () => {
    expect(validateRow({ external_id: 'a', email: 'a@b.co', first_name: 'A', status: '' })).toEqual({
      ok: true,
      row: {
        externalId: 'a',
        email: 'a@b.co',
        firstName: 'A',
        lastName: '',
        searchText: 'a',
        dietaryNotes: null,
        linkedinUrl: null,
      },
    });
  });

  it('T-GAS-07: maps rows by header name regardless of column order; skips blank rows', () => {
    const values = [
      ['Timestamp', 'Status', 'Email Address', 'First Name', 'Applicant ID', 'Sync Status', 'Extra question'],
      ['1/1', 'Accepted', 'ada@example.com', 'Ada', 'id-1', 'PASS_QUEUED', 'x'],
      ['', '', '', '', '', ''],
      ['1/2', '', 'ben@example.com', 'Ben', 'id-2'],
    ];
    expect(mapSheetValues(values)).toEqual([
      { external_id: 'id-1', email: 'ada@example.com', first_name: 'Ada', last_name: '', dietary_notes: '', linkedin_url: '', status: 'Accepted' },
      { external_id: 'id-2', email: 'ben@example.com', first_name: 'Ben', last_name: '', dietary_notes: '', linkedin_url: '', status: '' },
    ]);
    expect(() => mapSheetValues([['Applicant ID', 'First Name']])).toThrow('Missing header: Email Address');
    expect(() => mapSheetValues([['Applicant ID', 'Email Address']])).toThrow('Missing header: First Name');
    // v0.11.26: without an Applicant ID column the email is the key; headers match in any case; "LinkedIn" is LinkedIn URL.
    expect(mapSheetValues([['STATUS', 'email address', 'First Name', 'LinkedIn'], ['Yes', ' Ada@Example.COM ', 'Ada', 'linkedin.com/in/ada']])).toEqual([
      { external_id: 'ada@example.com', email: 'Ada@Example.COM', first_name: 'Ada', last_name: '', dietary_notes: '', linkedin_url: 'linkedin.com/in/ada', status: 'Yes' },
    ]);
    // v0.4: a Sheet without a Status column imports fine.
    expect(mapSheetValues([['Applicant ID', 'Email Address', 'First Name'], ['id-3', 'cy@example.com', 'Cy']])).toEqual([
      { external_id: 'id-3', email: 'cy@example.com', first_name: 'Cy', last_name: '', dietary_notes: '', linkedin_url: '', status: '' },
    ]);
  });
});

describe('linking a Sheet (SPEC F10)', () => {
  it('F10: accepts a Sheet id or a docs.google.com URL; rejects anything else', async () => {
    const { parseSheetId } = await import('@/lib/domain/sheet');
    const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
    expect(parseSheetId(id)).toBe(id);
    expect(parseSheetId(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=0`)).toBe(id);
    expect(parseSheetId(`  https://docs.google.com/spreadsheets/d/${id}  `)).toBe(id);
    for (const bad of ['not a sheet', 'https://evil.example/spreadsheets/d/' + id, 'short', '']) expect(parseSheetId(bad)).toBeNull();
  });
});
