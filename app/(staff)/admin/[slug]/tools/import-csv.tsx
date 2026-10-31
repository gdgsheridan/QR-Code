'use client';

import Link from 'next/link';
import { SectionLabel } from '@/components/section-label';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useState } from 'react';
import type { SheetStatus } from '@/lib/domain/sheet';
import { adminUrl, errorText, useApi } from '../api';

// F10 (v0.11.22): the same import as the Sheet bridge (F3), from a CSV export of the Sheet. A dry run
// shows what would change; nothing is written until Import is pressed, and new people aren't emailed.
const IMPORT_LINES: Array<[key: string, label: string]> = [
  ['CREATED', 'new, added as not RSVPed yet'],
  ['UPDATED', 'updated'],
  ['PASS_QUEUED', 'accepted with a new email (their pass is re-sent there)'],
  ['UNCHANGED', 'already up to date'],
  ['CONFLICT_DUPLICATE_EMAIL', 'skipped: email already used by another applicant'],
  ['INVALID', 'skipped: missing or invalid Applicant ID, email or name'],
];
const MAX_CSV_BYTES = 2_000_000;
// Owner's request (v0.11.27): every import takes only the people the Sheet accepted or waitlisted; no choice to make.
const STATUSES: SheetStatus[] = ['accepted', 'waitlisted'];

type Report = { total: number; skipped: number; counts: Record<string, number> };

function importLines(counts: Record<string, number>, skipped: number): string[] {
  const merged: Record<string, number> = {};
  for (const [k, n] of Object.entries(counts)) {
    const key = k.startsWith('INVALID') ? 'INVALID' : k;
    merged[key] = (merged[key] ?? 0) + n;
  }
  const lines = IMPORT_LINES.filter(([k]) => merged[k]).map(([k, label]) => `${merged[k]} ${label}`);
  if (skipped > 0) lines.push(`${skipped} skipped: Status isn’t Yes or Waitlist`);
  return lines;
}

const rowsText = (n: number) => `${n} ${n === 1 ? 'row' : 'rows'}`;

export function ImportCsv({ slug }: { slug: string }) {
  const api = useApi();
  const [csv, setCsv] = useState<string | null>(null);
  const [preview, setPreview] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Remounts the file input after an import, so the same file can be picked again.
  const [inputKey, setInputKey] = useState(0);
  const writes = preview ? (preview.counts.CREATED ?? 0) + (preview.counts.UPDATED ?? 0) + (preview.counts.PASS_QUEUED ?? 0) : 0;

  function sync(text: string, dryRun: boolean) {
    return api<Report>(adminUrl(slug, '/sync'), { method: 'POST', body: { dryRun, csv: text, statuses: STATUSES } });
  }

  async function check(text: string) {
    setPreview(null);
    setError(null);
    setBusy(true);
    const r = await sync(text, true);
    setBusy(false);
    if (!r.ok) return setError(r.status === 400 ? 'That file couldn’t be read as a CSV.' : errorText(r));
    setPreview(r.data);
  }

  async function choose(file: File | undefined) {
    setCsv(null);
    setPreview(null);
    setError(null);
    setDone(null);
    if (!file) return;
    if (file.size > MAX_CSV_BYTES) return setError('That file is over 2 MB. Is it the right one?');
    const text = await file.text();
    setCsv(text);
    await check(text);
  }

  async function apply() {
    if (csv === null) return;
    setBusy(true);
    const r = await sync(csv, false);
    setBusy(false);
    if (!r.ok) return setError(errorText(r));
    setCsv(null);
    setPreview(null);
    setInputKey((k) => k + 1);
    setDone(`✓ Imported ${rowsText(r.data.total)}: ${importLines(r.data.counts, r.data.skipped).join('; ')}.`);
  }

  return (
    <div className="grid gap-[24px] min-w-0 pb-[32px]">
      <header className="p-[8px_0px] [&_h1]:m-0 [&_h1]:text-[clamp(1.8rem,_3vw,_2.3rem)] [&_h1]:tracking-[-0.045em]">
        <SectionLabel>EVENT MANAGEMENT</SectionLabel>
        <h1>Tools</h1>
      </header>

      <section aria-labelledby="import-csv" className="grid gap-[14px] max-w-[640px] min-w-0 p-[20px] [border-width:1px] [border-style:solid] [border-color:var(--line)] rounded-lg [background:var(--card)] max-[600.001px]:p-[16px] [&_.tw-admin-field]:text-[11px] [&_.tw-admin-field]:font-semibold [&_.tw-admin-input]:min-h-[44px] [&_.tw-admin-check_input]:w-[16px] [&_.tw-admin-check_input]:h-[16px] [&_.tw-admin-check_input]:[accent-color:var(--accent)]">
        <div>
          <h2 id="import-csv" className="m-0 text-[1.08rem] tracking-[-0.02em]">Import CSV</h2>
          <p className="copy m-[7px_0px_0px] text-muted-foreground text-[0.88rem] leading-[1.65]">
            Download the Sheet as CSV (File → Download → Comma-separated values). People are matched by Applicant ID, or by email when the file has no Applicant ID column. Only rows whose Status is Yes (or Accepted) or Waitlist come in. New people are added as not RSVPed yet and aren’t emailed.
          </p>
        </div>
        <Label className="tw-admin-field grid gap-2 text-sm text-muted-foreground">
          CSV file
          <Input key={inputKey} className="tw-admin-input w-full" type="file" accept=".csv,text/csv" disabled={busy} onChange={(e) => void choose(e.target.files?.[0])} />
        </Label>
        {busy && !preview && <p role="status">Checking the file…</p>}
        {preview && (
          <div role="status">
            <p className="m-0">{rowsText(preview.total + preview.skipped)} in the file:</p>
            <ul className="m-[6px_0px_0px] pl-[18px] text-[13px] leading-[1.65]">
              {importLines(preview.counts, preview.skipped).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}
        {error && (
          <Alert className="flex items-start gap-[12px] p-[15px_17px] [border-width:1px] [border-style:solid] rounded-md [background:var(--card)] text-fg text-[13px] leading-[1.65] [overflow-wrap:anywhere] [&&]:[border-color:color-mix(in_srgb,_var(--bad,_#f87171)_40%,_var(--line))] [&&]:[background:color-mix(in_srgb,_#f87171_6%,_var(--card))]" asChild>
            <p role="alert">✕ {error}</p>
          </Alert>
        )}
        {done && (
          <Alert className="flex flex-wrap items-start gap-[6px_12px] p-[15px_17px] [border-width:1px] [border-style:solid] rounded-md text-fg text-[13px] leading-[1.65] [overflow-wrap:anywhere] [&&]:[border-color:color-mix(in_srgb,_var(--ok,_#4ade80)_40%,_var(--line))] [&&]:[background:color-mix(in_srgb,_#4ade80_6%,_var(--card))]" asChild>
            <div role="status">
              <p className="m-0">{done}</p>
              <Link href={`/admin/${slug}/participants`}>Open Participants →</Link>
            </div>
          </Alert>
        )}
        <div className="flex justify-end pt-[14px] [border-top-width:1px] [border-top-style:solid] [border-top-color:var(--line)]">
          <Button type="button" className="min-h-[44px] max-[480.001px]:flex-1" disabled={busy || writes === 0} onClick={() => void apply()}>
            {writes > 0 ? `Import ${writes}` : 'Import'}
          </Button>
        </div>
      </section>
    </div>
  );
}
