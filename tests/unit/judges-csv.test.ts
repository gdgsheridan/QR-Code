import { describe, expect, it } from 'vitest';
import { toCsv } from '@/lib/domain/csv';
import { parseJudgesCsv } from '@/lib/domain/judges';

const sheet = ([header, ...rows]: string[][]) => toCsv(header!, rows);

// SPEC §11 Judges (v0.12.4): the organizers' judge tracker, and the judging sheet's Judges tab, as CSV.
describe('parseJudgesCsv (T-JUDGE-01)', () => {
  it('T-JUDGE-01: the tracker keeps Confirmed (and Accepted) rows with name, title and a normalized LinkedIn', () => {
    const csv = sheet([
      ['Name', 'Title @ Company', 'LinkedIn', 'Contact', 'Track', 'Status', 'Notes'],
      ['Dr. Wael Ramadan', 'Professor @ Sheridan College', 'https://www.linkedin.com/in/ACoAAATRYlABG7pbDy-nuUvo7EFlVAIib6gdNEE', 'w@x.ca', 'Overall', 'Confirmed', 'Dietary: halal'],
      ['  Ayush   Singh ', 'Research Scientist @ Meta', 'linkedin.com/in/ayush-singh-se/', 'a@meta.com', 'Data', ' confirmed ', ''],
      ['Pending Person', 'CTO @ X', 'https://www.linkedin.com/in/pending', '', '', 'Contacted', ''],
      ['Old Judge', '', 'https://www.linkedin.com/company/acme', '', '', 'Accepted', ''],
      ['', '', '', '', '', 'Confirmed', ''],
    ]);
    const r = parseJudgesCsv(csv);
    expect(r).toEqual({
      ok: true,
      skipped: 1,
      badLinkedin: 1,
      judges: [
        { name: 'Dr. Wael Ramadan', title: 'Professor @ Sheridan College', linkedinUrl: 'https://www.linkedin.com/in/ACoAAATRYlABG7pbDy-nuUvo7EFlVAIib6gdNEE' },
        { name: 'Ayush Singh', title: 'Research Scientist @ Meta', linkedinUrl: 'https://www.linkedin.com/in/ayush-singh-se' },
        { name: 'Old Judge', title: null, linkedinUrl: null },
      ],
    });
    // Nothing but name, title and LinkedIn is kept: no emails or notes.
    expect(JSON.stringify(r)).not.toMatch(/@meta\.com|w@x\.ca|halal/);
  });

  it('T-JUDGE-01: the judging sheet keeps Judging? = Yes; a name listed twice is one judge; no Name header is an error', () => {
    const csv = sheet([
      ['Name', 'Title @ Company', 'Email', 'Group', 'Judging?', 'Notes'],
      ['Mahir Azim', 'AI PM @ EY', 'm@x.com', 'General', 'Yes', ''],
      ['Not Judging', 'X', '', '', 'No', ''],
      ['mahir azim', 'AI Product Manager @ EY', '', '', 'yes', ''],
    ]);
    expect(parseJudgesCsv(csv)).toEqual({ ok: true, skipped: 1, badLinkedin: 0, judges: [{ name: 'mahir azim', title: 'AI Product Manager @ EY', linkedinUrl: null }] });
    expect(parseJudgesCsv('Who,Title\nA,B\n')).toEqual({ ok: false, error: 'missing_name' });
    expect(parseJudgesCsv('')).toEqual({ ok: false, error: 'missing_name' });
  });
});
