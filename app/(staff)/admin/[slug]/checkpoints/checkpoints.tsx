'use client';

import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';

import { Fragment, useCallback, useRef, useState } from 'react';
import { formatEventDateTime, toLocalInput, zonedToUtc } from '@/lib/domain/event-time';
import { toSearchText } from '@/lib/domain/normalize';
import { adminUrl, errorText, useApi, useLoad } from '../api';
import { ConfirmDialog, Modal, VoidDialog } from '../dialog';
import { KIND_LABEL } from '@/app/(staff)/scan/[slug]/types';
import { PageHeader } from '../page-header';

type Kind = 'door' | 'meal' | 'session' | 'custom';
interface Checkpoint {
  id: string;
  name: string;
  kind: Kind;
  isOpen: boolean;
  requiresCheckin: boolean;
  capacity: number | null;
  startsAt: string | null;
  sortOrder: number;
  secondsMode: boolean;
}

const KINDS: Kind[] = ['door', 'meal', 'session', 'custom'];
const ERROR_TEXT: Record<string, string> = {
  DOOR_EXISTS: 'This event already has a door checkpoint.',
  NAME_TAKEN: 'Another checkpoint already has that name.',
};

export function Checkpoints({ slug }: { slug: string }) {
  const api = useApi();
  const [rows, setRows] = useState<Checkpoint[] | null>(null);
  const [timezone, setTimezone] = useState('UTC');
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<Checkpoint | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Checkpoint | null>(null);
  const [peopleOpen, setPeopleOpen] = useState<string | null>(null); // the checkpoint whose People list is open

  const load = useCallback(async () => {
    const [r, e] = await Promise.all([api<{ checkpoints: Checkpoint[] }>(adminUrl(slug, '/checkpoints')), api<{ timezone: string }>(adminUrl(slug, '/event'))]);
    if (r.ok) setRows(r.data.checkpoints);
    else setMessage(`✕ ${errorText(r)}`);
    if (e.ok) setTimezone(e.data.timezone);
  }, [api, slug]);

  useLoad(load);

  async function toggle(c: Checkpoint) {
    const r = await api(adminUrl(slug, `/checkpoints/${c.id}`), { method: 'PATCH', body: { isOpen: !c.isOpen } });
    setMessage(r.ok ? `✓ ${c.name} is now ${c.isOpen ? 'closed' : 'open'}.` : `✕ ${errorText(r)}`);
    await load();
  }

  // v0.12 (owner's request): a meal in seconds mode serves someone who was already served when they tap in again.
  async function seconds(c: Checkpoint) {
    const r = await api(adminUrl(slug, `/checkpoints/${c.id}`), { method: 'PATCH', body: { secondsMode: !c.secondsMode } });
    setMessage(r.ok ? `✓ ${c.name}: seconds ${c.secondsMode ? 'off. Each hacker is served once.' : 'on. Hackers already served can tap in again.'}` : `✕ ${errorText(r)}`);
    await load();
  }

  async function remove(c: Checkpoint) {
    setDeleting(null);
    const r = await api(adminUrl(slug, `/checkpoints/${c.id}`), { method: 'DELETE' });
    setMessage(r.ok ? `✓ Deleted ${c.name}.` : `✕ ${errorText(r)}`);
    await load();
  }

  return (
    <>
      <PageHeader title="Checkpoints" description="Manage entry points, meal stations, and event sessions.">
        <Button type="button" onClick={() => setEditing('new')}>
          <span aria-hidden="true">+ </span>Add checkpoint
        </Button>
      </PageHeader>

      {rows !== null && (
        <p className="text-muted-foreground text-[12px] leading-[1.7]">
          {rows.length} {rows.length === 1 ? 'checkpoint' : 'checkpoints'}
        </p>
      )}
      {message && (
        <Alert className={`flex items-start gap-[12px] m-[0px_0px_14px] p-[15px_17px] [border-width:1px] [border-style:solid]
                [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]
                [border-left-color:var(--line)] rounded-md [background:var(--card)] text-fg text-[13px]
                leading-[1.65] [overflow-wrap:anywhere]` + ' ' + (message.startsWith('✓') ? `[&&]:[border-color:color-mix(in_srgb,_var(--ok,_#4ade80)_40%,_var(--line))]
                [&&]:[background:color-mix(in_srgb,_#4ade80_6%,_var(--card))]` : `[&&]:[border-color:color-mix(in_srgb,_var(--warn,_#fbbf24)_40%,_var(--line))]
                [&&]:[background:color-mix(in_srgb,_#fbbf24_6%,_var(--card))]`)} asChild role="status"><p  data-tone={message.startsWith('✓') ? 'ok' : message.startsWith('✕') ? 'bad' : 'warn'} role="status">
          {message}
        </p></Alert>
      )}
      {rows === null ? (
        <Alert className="tw-admin-muted text-muted-foreground text-[12px] leading-[1.7]" asChild role="status"><p  role="status">
          Loading checkpoints…
        </p></Alert>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-[12px] min-h-[220px] mt-[16px] p-[32px_24px] text-center

          [background:var(--card)] [border-width:1px] [border-style:dashed] [border-top-color:var(--line)]

          [border-right-color:var(--line)] [border-bottom-color:var(--line)] [border-left-color:var(--line)]

          rounded-lg max-[600.001px]:min-h-[180px] max-[600.001px]:p-[24px_16px] [&_h2]:m-0
          [&_h2]:text-[20px]
 [&_p]:max-w-[440px] [&_p]:m-0 [&_p]:text-[14px] [&_p]:leading-[1.6]">
          <h2>No checkpoints yet</h2>
          <p className="copy tw-admin-muted text-muted-foreground text-[12px] leading-[1.7]">
            Add your first checkpoint to start managing event entry and attendance.
          </p>
          <Button type="button" onClick={() => setEditing('new')}>
            + Add your first checkpoint
          </Button>
        </div>
      ) : (
        <div className="tw-admin-tableWrap overflow-x-auto [background:var(--card)] [border-width:1px] [border-style:solid]

          [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]

          [border-left-color:var(--line)] rounded-card shadow-panel max-[600.001px]:max-w-full">
          <Table className="tw-admin-table [&_.tw-admin-num]:text-right! [&_.tw-admin-actions]:flex [&_.tw-admin-actions]:items-center [&_.tw-admin-actions]:gap-1 [&_.tw-admin-actions_button]:px-2 [&_.tw-admin-actions_button]:text-xs [&_.tw-admin-badge]:text-xs">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Needs check-in</TableHead>
                <TableHead className="tw-admin-num text-right! tabular-nums">Capacity</TableHead>
                <TableHead>Starts</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <Fragment key={c.id}>
                <TableRow>
                  <TableCell>{c.name}</TableCell>
                  <TableCell>{KIND_LABEL[c.kind].toLowerCase()}</TableCell>
                  <TableCell>
                    <span data-testid="cp-state" className={`tw-admin-checkpointState inline-flex items-center justify-center gap-[7px] min-w-[82px] p-[6px_10px] [border-width:1px] [border-style:solid] [border-color:currentcolor] rounded-sm text-[12px] font-bold leading-[1.2] whitespace-nowrap ${c.isOpen ? `[&.tw-admin-checkpointState]:text-fg [&.tw-admin-checkpointState]:[background:var(--card)]
                [&.tw-admin-checkpointState]:border-accent` : `[&.tw-admin-checkpointState]:text-muted-foreground [&.tw-admin-checkpointState]:[background:transparent]
                [&.tw-admin-checkpointState]:border-line`}`}>
                      {c.isOpen ? '● Open' : '○ Closed'}
                    </span>
                  </TableCell>
                  <TableCell>{c.requiresCheckin ? 'Yes' : 'No'}</TableCell>
                  <TableCell className="tw-admin-num text-right! tabular-nums">{c.capacity ?? '—'}</TableCell>
                  <TableCell>{c.startsAt ? formatEventDateTime(c.startsAt, timezone) : '—'}</TableCell>
                  <TableCell>
                    <div className="tw-admin-actions flex flex-nowrap gap-[6px]">
                      <Button type="button" className="min-h-[44px] p-[0px_12px] text-[14px]" aria-label={`${c.isOpen ? 'Close' : 'Open'} ${c.name}`} onClick={() => void toggle(c)}>
                        {c.isOpen ? 'Close' : 'Open'}
                      </Button>
                      <PeopleToggle name={c.name} open={peopleOpen === c.id} controls={`people-${c.id}`} onToggle={() => setPeopleOpen((o) => (o === c.id ? null : c.id))} />
                      {c.kind === 'meal' && (
                        <Button type="button" variant="outline" aria-label={`Seconds for ${c.name}`} aria-pressed={c.secondsMode} onClick={() => void seconds(c)}>
                          Seconds: {c.secondsMode ? 'On' : 'Off'}
                        </Button>
                      )}
                      <Button type="button" variant="outline" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}>
                        Edit
                      </Button>
                      <Button type="button" variant="ghost" className="tw-admin-danger text-destructive hover:bg-destructive/10" aria-label={`Delete ${c.name}`} onClick={() => setDeleting(c)}>
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
                {peopleOpen === c.id && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={7} className="p-0">
                      <CheckpointPeople id={`people-${c.id}`} slug={slug} checkpoint={c} timezone={timezone} />
                    </TableCell>
                  </TableRow>
                )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {editing && (
        <CheckpointForm
          slug={slug}
          timezone={timezone}
          initial={editing === 'new' ? null : editing}
          onDone={async (msg) => {
            setEditing(null);
            setMessage(msg);
            await load();
          }}
          onCancel={() => setEditing(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          body={<p className="copy">A checkpoint can only be deleted once nobody is scanned there (remove them under People). Scans you already removed are deleted with it.</p>}
          confirmLabel="Delete checkpoint"
          danger
          onConfirm={() => void remove(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  );
}

function CheckpointForm(props: { slug: string; timezone: string; initial: Checkpoint | null; onDone: (msg: string) => void; onCancel: () => void }) {
  const api = useApi();
  const init = props.initial;
  const [name, setName] = useState(init?.name ?? '');
  const [kind, setKind] = useState<Kind>(init?.kind ?? 'session');
  const [capacity, setCapacity] = useState(init?.capacity?.toString() ?? '');
  const [requiresCheckin, setRequiresCheckin] = useState(init?.requiresCheckin ?? true);
  const [sortOrder, setSortOrder] = useState(init?.sortOrder.toString() ?? '0');
  const [startsAt, setStartsAt] = useState(init?.startsAt ? toLocalInput(init.startsAt, props.timezone) : '');
  const [error, setError] = useState<string | null>(null);
  const isDoor = kind === 'door';

  async function submit() {
    const cap = capacity.trim() === '' ? null : Number(capacity);
    if (cap !== null && (!Number.isInteger(cap) || cap <= 0)) return setError('Capacity must be a whole number above 0, or empty.');
    const body = {
      name,
      ...(init ? {} : { kind }),
      capacity: cap,
      requiresCheckin: isDoor ? false : requiresCheckin,
      sortOrder: Number(sortOrder) || 0,
      startsAt: startsAt ? zonedToUtc(startsAt, props.timezone) : null,
    };
    const r = init
      ? await api(adminUrl(props.slug, `/checkpoints/${init.id}`), { method: 'PATCH', body })
      : await api(adminUrl(props.slug, '/checkpoints'), { method: 'POST', body });
    if (!r.ok) return setError(ERROR_TEXT[r.data.error ?? ''] ?? (r.status === 400 ? 'Check the fields.' : errorText(r)));
    props.onDone(`✓ ${init ? 'Saved' : 'Added'} ${name}.${init ? '' : ' It starts closed.'}`);
  }

  return (
    <Modal title={init ? `Edit ${init.name}` : 'Add checkpoint'} onCancel={props.onCancel}>
      <form
        className="grid gap-[14px] [&_>_.tw-admin-muted]:m-[-4px_0px_0px] [&_>_.tw-admin-muted]:text-[12px]

          [&_>_.tw-admin-muted]:leading-[1.6] [&_>_button]:min-h-[44px] [&_>_button]:p-[8px_12px]

          [&_>_button]:rounded-md [&_>_button]:[font-family:inherit] [&_>_button]:text-[12px]

          [&_>_button]:font-semibold"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Label className="tw-admin-field grid min-w-[140px] flex-[1_1_180px] gap-2 text-sm text-muted-foreground">
          Name
          <Input className="tw-admin-input w-full" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </Label>
        <Label className="tw-admin-field grid min-w-[140px] flex-[1_1_180px] gap-2 text-sm text-muted-foreground">
          Kind
          <NativeSelect className="tw-admin-input w-full" value={kind} disabled={init !== null} onChange={(e) => setKind(e.target.value as Kind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k].toLowerCase()}
              </option>
            ))}
          </NativeSelect>
        </Label>
        <Label className="tw-admin-field grid min-w-[140px] flex-[1_1_180px] gap-2 text-sm text-muted-foreground">
          Capacity
          <Input className="tw-admin-input w-full" inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        </Label>
        <Label className="tw-admin-check">
          <input type="checkbox" checked={isDoor ? false : requiresCheckin} disabled={isDoor} onChange={(e) => setRequiresCheckin(e.target.checked)} /> Requires door check-in first
        </Label>
        <Label className="tw-admin-field grid min-w-[140px] flex-[1_1_180px] gap-2 text-sm text-muted-foreground">
          Starts ({props.timezone})
          <Input className="tw-admin-input w-full" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </Label>
        <Label className="tw-admin-field grid min-w-[140px] flex-[1_1_180px] gap-2 text-sm text-muted-foreground">
          Sort order
          <Input className="tw-admin-input w-full" inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        </Label>
        {error && (
          <Alert className="flex items-start gap-[12px] m-[0px_0px_14px] p-[15px_17px] [border-width:1px] [border-style:solid]

          [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]

          [border-left-color:var(--line)] rounded-md [background:var(--card)] text-fg text-[13px]

          leading-[1.65] [overflow-wrap:anywhere]

          [&&]:[border-color:color-mix(in_srgb,_var(--bad,_#f87171)_40%,_var(--line))]

          [&&]:[background:color-mix(in_srgb,_#f87171_6%,_var(--card))]" asChild><p  role="alert">
            ✕ {error}
          </p></Alert>
        )}
        <div className="flex gap-[8px] justify-end flex-wrap mt-[8px] pt-[14px] [border-top-width:1px] [border-top-style:solid]

          [border-top-color:var(--line)] [&_button]:min-h-[44px] [&_button]:p-[8px_12px] [&_button]:rounded-md

          [&_button]:[font-family:inherit] [&_button]:text-[12px] [&_button]:font-semibold

          max-[480.001px]:[&_button]:flex-1">
          <Button type="button" variant="outline" onClick={props.onCancel}>
            Cancel
          </Button>
          <Button type="submit">{init ? 'Save' : 'Add checkpoint'}</Button>
        </div>
      </form>
    </Modal>
  );
}

interface ScanRow {
  id: string;
  displayName: string;
  isTest: boolean;
  scannedAt: string;
  method: 'qr' | 'manual' | 'nfc';
  scannedByName: string | null;
  canRemove: boolean;
}

const HOW: Record<ScanRow['method'], string> = { qr: 'QR', nfc: 'Badge', manual: 'Manual' };

// SPEC §11 (v0.8): who was scanned at a checkpoint, newest first. Remove voids the scan (F11, I-9): it stays
// in the history but stops counting, and the person can be scanned again.
// Opens as a dropdown under its checkpoint's row (Checkpoints and Workshops tabs, owner's request): the row's People
// button toggles it, so there is no heading or Close of its own; `id` is what that button's aria-controls points at.
export function CheckpointPeople(props: { id: string; slug: string; checkpoint: Pick<Checkpoint, 'id' | 'name'>; timezone: string }) {
  const api = useApi();
  const { slug, checkpoint } = props;
  const [rows, setRows] = useState<ScanRow[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<ScanRow | null>(null);
  const [removing, setRemoving] = useState(false); // one removal (and its refresh) at a time
  const count = useRef<HTMLParagraphElement>(null);
  const [q, setQ] = useState(''); // owner's request: find someone in this checkpoint's list by name (I-12)
  const needle = toSearchText(q);
  const shown = rows?.filter((r) => toSearchText(r.displayName).includes(needle)) ?? [];

  const load = useCallback(async () => {
    const r = await api<{ scans: ScanRow[] }>(`/api/events/${encodeURIComponent(slug)}/checkpoints/${checkpoint.id}/scans`);
    if (r.ok) setRows(r.data.scans);
    else setMessage(`✕ ${errorText(r)}`);
  }, [api, slug, checkpoint.id]);

  useLoad(load);

  async function remove(row: ScanRow, reason: string) {
    setVoiding(null);
    setRemoving(true);
    const r = await api<{ code: string }>(`/api/scans/${row.id}/void`, { method: 'POST', body: { reason } });
    const done = r.ok && (r.data.code === 'VOIDED' || r.data.code === 'ALREADY_VOIDED');
    setMessage(done ? `✓ Removed ${row.displayName} from ${checkpoint.name}.` : `✕ ${r.ok ? `Couldn’t remove (${r.data.code}).` : errorText(r)}`);
    await load();
    setRemoving(false);
    count.current?.focus(); // the row (and its button) is gone: keep keyboard focus in the list
  }

  return (
    <section id={props.id} aria-label={`People at ${checkpoint.name}`} className="grid gap-[10px] p-[14px_16px_16px] border-l-2 border-accent [background:color-mix(in_srgb,_var(--accent)_4%,_var(--card))]">
      {message && (
        <p role="status" data-tone={message.startsWith('✓') ? 'ok' : message.startsWith('✕') ? 'bad' : 'warn'} className="m-0 text-[13px] leading-[1.6] [overflow-wrap:anywhere]">
          {message}
        </p>
      )}
      {rows === null ? (
        <p className="m-0 text-muted-foreground text-[12px]">Loading…</p>
      ) : (
        <>
          {rows.length > 0 && (
            <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Search people at ${checkpoint.name}`}
              placeholder="Search by name" className="max-w-[320px] text-[14px]" />
          )}
          <p ref={count} tabIndex={-1} aria-live="polite" className="m-0 text-muted-foreground text-[12px] leading-[1.7] outline-none">
            {needle && rows.length > 0 && `${shown.length} of `}{rows.length} {rows.length === 1 ? 'person' : 'people'}
          </p>
          {needle && rows.length > 0 && shown.length === 0 && (
            <p className="m-0 text-muted-foreground text-[13px]">Nobody here matches “{q.trim()}”.</p>
          )}
          {shown.length > 0 && (
            <Table className="tw-admin-table text-[13px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Scanned</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>How</TableHead>
                  <TableHead><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      {r.displayName}
                      {r.isTest && <span className="text-muted-foreground text-[12px]"> (test)</span>}
                    </TableCell>
                    <TableCell>{formatEventDateTime(r.scannedAt, props.timezone)}</TableCell>
                    <TableCell>{r.scannedByName ?? '—'}</TableCell>
                    <TableCell>{HOW[r.method]}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="ghost" className="tw-admin-danger min-h-[44px] text-destructive hover:bg-destructive/10"
                        aria-label={`Remove ${r.displayName}`}
                        disabled={removing}
                        onClick={() => setVoiding(r)}
                      >
                        Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}
      {voiding && (
        <VoidDialog what={`${voiding.displayName}’s ${checkpoint.name} scan`} onSubmit={(reason) => void remove(voiding, reason)} onCancel={() => setVoiding(null)} />
      )}
    </section>
  );
}

// The People toggle both tabs put in a checkpoint's row; the list itself goes in the next row (CheckpointPeople).
export function PeopleToggle({ name, open, controls, onToggle }: { name: string; open: boolean; controls: string; onToggle: () => void }) {
  return (
    <Button type="button" variant="outline" aria-label={`People at ${name}`} aria-expanded={open} aria-controls={controls} onClick={onToggle}>
      People
      <span aria-hidden="true" className={`inline-block text-[10px] transition-transform duration-150 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}>▼</span>
    </Button>
  );
}

