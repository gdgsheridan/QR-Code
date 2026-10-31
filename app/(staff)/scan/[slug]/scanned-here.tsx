'use client';

import { SectionLabel } from '@/components/section-label';
import { Card } from '@/components/ui/card';
import { Entrance } from '@/components/motion';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';

import { useCallback, useEffect, useRef, useState } from 'react';
import { requestVoid } from '@/lib/scanner/undo';
import { UndoDialog } from './undo-dialog';

interface Row {
  id: string;
  displayName: string;
  isTest: boolean;
  scannedAt: string;
  method: 'qr' | 'manual' | 'nfc';
  scannedByName: string | null;
  canRemove: boolean;
}

type ListState = { kind: 'loading' } | { kind: 'rows'; rows: Row[] } | { kind: 'error' };

const HOW: Record<Row['method'], string> = { qr: 'QR', nfc: 'Badge', manual: 'Manual' };

// SPEC §10.6 (v0.8): who was scanned at this checkpoint, newest first. Remove = void (F11): the server
// decides who may (organizers any scan, volunteers their own within 120 s); canRemove only shows the button.
export function ScannedHere(props: {
  slug: string;
  checkpoint: { id: string; name: string };
  timezone: string;
  /** Offline: removing would fail, so it's disabled (like Manual search). */
  disabled: boolean;
  onClose: () => void;
  onUnauthorized: () => void;
  onRemoved: (scanId: string) => void;
}) {
  const { slug, checkpoint, onUnauthorized } = props;
  const [state, setState] = useState<ListState>({ kind: 'loading' });
  const [removing, setRemoving] = useState<Row | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removingNow, setRemovingNow] = useState(false); // one removal (and its refresh) at a time
  const heading = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(slug)}/checkpoints/${checkpoint.id}/scans`, {
        cache: 'no-store',
        // A11: bound the reload too, so a stalled list can't hold the remove pending state.
        signal: AbortSignal.timeout(8000),
      });
      if (res.status === 401) return onUnauthorized();
      if (!res.ok) return setState({ kind: 'error' });
      setState({ kind: 'rows', rows: ((await res.json()) as { scans: Row[] }).scans });
    } catch {
      setState({ kind: 'error' });
    }
  }, [slug, checkpoint.id, onUnauthorized]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  async function remove(row: Row, reason: string) {
    setRemoving(null);
    setRemovingNow(true);
    // A11: the pending flag always clears, even if the void or the reload hangs.
    try {
      await removeAndReload(row, reason);
    } finally {
      setRemovingNow(false);
      heading.current?.focus(); // the row (and its button) is gone: keep keyboard focus in the sheet
    }
  }

  async function removeAndReload(row: Row, reason: string) {
    // A11: 8 s timeout via requestVoid; a stall surfaces instead of hanging.
    const outcome = await requestVoid(row.id, reason);
    if (outcome.kind === 'unauthorized') return onUnauthorized();
    if (outcome.kind === 'no-connection') return setNotice('✕ Couldn’t remove: no connection.');
    if (outcome.kind === 'voided' || outcome.kind === 'already-voided') {
      setNotice(`✓ Removed ${row.displayName}. They can be scanned again.`);
      props.onRemoved(row.id);
    } else if (outcome.kind === 'forbidden') setNotice('✕ Too late to remove that one. Ask an organizer.');
    else setNotice('✕ Couldn’t remove. Try again.');
    await load();
  }

  const time = new Intl.DateTimeFormat(undefined, { timeZone: props.timezone, weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const count = state.kind === 'rows' ? ` · ${state.rows.length} ${state.rows.length === 1 ? 'person' : 'people'}` : '';
  return (
    <Entrance><Card className="tw-scanner-sheet fixed inset-0 z-[15] flex flex-col gap-0 rounded-none border-0 bg-bg p-0 font-mono text-fg shadow-none sm:inset-6 sm:mx-auto sm:max-w-[760px] sm:rounded-card sm:border sm:border-solid sm:border-line" asChild><section  aria-labelledby="scanned-title">
      <div className="flex gap-[12px] items-center p-[20px_24px] [border-bottom-width:1px] [border-bottom-style:solid]

          [border-bottom-color:var(--line)] [background:var(--card)] [&_h2]:flex-1 [&_h2]:m-0 [&_h2]:text-[22px]

          [&_h2]:tracking-[-0.03em]">
        <h2 id="scanned-title" ref={heading} tabIndex={-1}>
          Scanned here
        </h2>
        {/* Focus starts inside the sheet, like Manual search's input. */}
        <Button type="button" variant="outline" onClick={props.onClose} autoFocus>
          Close
        </Button>
      </div>
      <SectionLabel className="mx-6 mt-5 mb-4">
        {checkpoint.name}
        {count}
      </SectionLabel>
      {notice && (
        <Alert className="p-[0px_24px_16px] text-muted-foreground text-[14px]" asChild role="status"><p  role="status">
          {notice}
        </p></Alert>
      )}
      {state.kind === 'loading' && <p className="p-[0px_24px_16px] text-muted-foreground text-[14px]">Loading…</p>}
      {state.kind === 'error' && <p className="p-[0px_24px_16px] text-muted-foreground text-[14px]">✕ Couldn’t load the list. Try again.</p>}
      {state.kind === 'rows' && state.rows.length === 0 && <p className="p-[0px_24px_16px] text-muted-foreground text-[14px]">No one yet.</p>}
      {state.kind === 'rows' && state.rows.length > 0 && (
        <ul className="list-none m-0 grid content-start gap-3 p-4 pt-0 sm:px-6 sm:pb-6 overflow-y-auto">
          {state.rows.map((r) => (
            <li key={r.id} className="flex flex-wrap gap-4 items-center rounded-card border border-solid border-line bg-card p-4">
              <div className="flex-1 min-w-[140px] [overflow-wrap:anywhere]">
                <div className="font-bold text-base mb-1 break-words">
                  {r.displayName}
                  {r.isTest && ' (test)'}
                </div>
                <div className="text-[13px] leading-[1.8] text-muted-foreground">
                  {time.format(new Date(r.scannedAt))} · {HOW[r.method]}
                  {r.scannedByName && ` · by ${r.scannedByName}`}
                </div>
              </div>
              {r.canRemove && (
                <Button type="button" variant="outline" disabled={props.disabled || removingNow} onClick={() => setRemoving(r)} aria-label={`Remove ${r.displayName}`}>
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {removing && <UndoDialog title={`Remove ${removing.displayName}?`} onSubmit={(reason) => void remove(removing, reason)} onCancel={() => setRemoving(null)} />}
    </section></Card></Entrance>
  );
}
