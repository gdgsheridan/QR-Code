'use client';

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

import { useCallback, useEffect, useRef, useState } from 'react';
import { linkNotice, normalizeUid } from '@/lib/domain/badge';
import { useBadgeWrite } from '@/lib/scanner/badge-write';
import { useNfcReader, type NfcTag } from '@/lib/scanner/nfc';
import { adminUrl, errorText, useApi } from '../api';
import { ConfirmDialog, Modal } from '../dialog';
import { ParticipantDetail } from './detail';
import { fullName } from './name';

export interface Row {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  status: 'pending' | 'accepted' | 'waitlisted' | 'rejected' | 'withdrawn';
  source: string;
  isTest: boolean;
  hasBadge: boolean;
  passState: 'active' | 'revoked' | 'none';
  liveScans: number;
  checkedIn: boolean;
  rsvpSentAt: string | null;
}

type Pending = { kind: 'resend' | 'revoke' | 'revoke-rsvp' | 'unlink' | 'delete'; row: Row } | { kind: 'walk-in' } | null;
const STATUSES = ['accepted', 'pending', 'waitlisted', 'rejected', 'withdrawn'] as const;

const ALREADY_UNLINKED = '! That badge was already unlinked.';
const RESULT_TEXT: Record<string, string> = {
  QUEUED: '✓ New pass queued. Their old code has stopped working.',
  IN_FLIGHT: '! A pass email is already on its way.',
  NOT_ACCEPTED: '! Only accepted participants can get a pass.',
  REVOKED: '✓ Pass revoked.',
  UNLINKED: '✓ Badge unlinked. It stops working until it’s linked again.',
  RESET: '✓ RSVP revoked. They’re back to not RSVPed yet.',
  NO_ACTIVE_PASS: '! They had no active pass.',
  DELETED: '✓ Participant deleted. Their scans still count in totals.',
  ALREADY_DELETED: '! Already deleted.',
};

export function Participants({ slug, badgeOrigin }: { slug: string; badgeOrigin: string }) {
  const api = useApi();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [noShow, setNoShow] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [badgeTarget, setBadgeTarget] = useState<Row | null>(null);
  const [badgeError, setBadgeError] = useState<string | null>(null);
  const [badgeBusy, setBadgeBusy] = useState(false);
  const linking = useRef(false);
  const badgeWrite = useBadgeWrite(badgeOrigin);
  // F13: who gets an RSVP. Accepted people can't be picked (they're already in).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const invitable = (rows ?? []).filter((r) => r.status !== 'accepted');
  const picked = invitable.filter((r) => selected.has(r.id));

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (q.trim()) params.set('q', q.trim());
    if (noShow) params.set('noShow', '1');
    const r = await api<{ participants: Row[] }>(adminUrl(slug, `/participants?${params}`));
    if (r.ok) setRows(r.data.participants);
    else setMessage(`✕ ${errorText(r)}`);
  }, [api, slug, status, q, noShow]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  async function linkBadge(tag: NfcTag, reader: NDEFReader, row: Row) {
    if (linking.current) return;
    const uid = normalizeUid(tag.serial);
    if (!uid) return setBadgeError('Couldn’t read that badge. Hold it still and tap again.');
    linking.current = true; // Android can report one tap twice
    setBadgeBusy(true);
    const write = await badgeWrite.write(tag, reader, uid);
    nfc.stop();
    const r = await api<{ code?: string }>(`/api/events/${encodeURIComponent(slug)}/badges`, {
      method: 'POST',
      body: { participantId: row.id, uid },
    });
    setBadgeTarget(null);
    setBadgeBusy(false);
    setMessage(linkNotice(r.ok ? r.data.code : undefined, uid, fullName(row), write).text);
    await load();
  }

  const nfc = useNfcReader({
    prefKey: 'station:linker',
    defaultOn: false,
    autoStart: false,
    onTag: (tag, reader) => {
      badgeWrite.observe(tag.serial);
      if (badgeTarget) void linkBadge(tag, reader, badgeTarget);
    },
    onUnreadable: () => {
      if (badgeTarget && !linking.current) setBadgeError('Couldn’t read that badge. Hold it still and tap again.');
    },
  });

  function startLink(row: Row) {
    linking.current = false;
    setBadgeTarget(row);
    setBadgeError(null);
    if (nfc.state === 'off') void nfc.start(); // this click is the user gesture Chrome needs
  }

  function cancelLink() {
    badgeWrite.cancel();
    linking.current = true;
    nfc.stop();
    setBadgeTarget(null);
  }

  async function act(kind: 'resend' | 'revoke' | 'revoke-rsvp' | 'unlink' | 'delete', row: Row) {
    setPending(null);
    const path = `/participants/${row.id}${kind === 'delete' ? '' : `/${kind === 'unlink' ? 'badge' : kind}`}`;
    const r = await api<{ code: string }>(adminUrl(slug, path), { method: kind === 'delete' || kind === 'unlink' ? 'DELETE' : 'POST' });
    // Unlink answers 404 when the badge is already gone (moved, or the attendee said No): what was wanted anyway.
    const gone = kind === 'unlink' && r.status === 404;
    setMessage(r.ok ? (RESULT_TEXT[r.data.code] ?? r.data.code) : gone ? ALREADY_UNLINKED : `✕ ${errorText(r)}`);
    if (kind === 'delete' && openId === row.id) setOpenId(null);
    await load();
  }

  function pick(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function sendRsvps() {
    const r = await api<{ queued: number }>(adminUrl(slug, '/participants/rsvp'), { method: 'POST', body: { ids: picked.map((p) => p.id) } });
    setMessage(r.ok ? `✓ RSVP emails queued for ${r.data.queued} ${r.data.queued === 1 ? 'person' : 'people'}.` : `✕ ${errorText(r)}`);
    if (r.ok) setSelected(new Set());
    await load();
  }

  async function toggleTest(row: Row) {
    const r = await api(adminUrl(slug, `/participants/${row.id}/test`), { method: 'POST', body: { isTest: !row.isTest } });
    if (!r.ok) setMessage(`✕ ${errorText(r)}`);
    await load();
  }

  return (
    <>
      <h1>Participants</h1>
      <div className="tw-admin-toolbar flex flex-wrap [align-items:end] gap-[14px] mb-[20px] p-[18px] [border-width:1px]

          [border-style:solid] [border-top-color:var(--line)] [border-right-color:var(--line)]

          [border-bottom-color:var(--line)] [border-left-color:var(--line)] rounded-card

          [background:var(--surface)]

          shadow-panel max-[700.001px]:items-stretch max-[700.001px]:gap-[12px] max-[700.001px]:p-[14px]

          [&_.tw-admin-input]:w-full [&_.tw-admin-input]:min-h-[44px] [&_.tw-admin-input]:text-[14px]

          [&_.tw-admin-input]:tracking-[normal] [&_.tw-admin-input]:normal-case

          [&_.tw-admin-input]:[font-family:inherit] [&_.tw-admin-input]:font-normal

          [&_.tw-admin-check]:min-h-[44px] [&_.tw-admin-check]:inline-flex [&_.tw-admin-check]:items-center

          [&_.tw-admin-check]:gap-[9px] [&_.tw-admin-check]:p-[0px_4px] [&_.tw-admin-check]:text-fg

          [&_.tw-admin-check]:text-[13px] [&_.tw-admin-check]:tracking-[normal] [&_.tw-admin-check]:normal-case

          max-[700.001px]:[&_.tw-admin-check]:[flex:1_1_100%] [&_>_button]:min-h-[44px] [&_>_button]:p-[0px_16px]

          [&_>_button]:whitespace-nowrap max-[700.001px]:[&_>_button]:[flex:1_1_auto]

          [&_.tw-admin-field]:[font-family:inherit] [&_.tw-admin-field]:text-[12px]

          [&_.tw-admin-field]:font-semibold [&_.tw-admin-field]:tracking-[0.02em] [&_.tw-admin-field]:normal-case

          max-[700.001px]:[&_.tw-admin-field]:[flex:1_1_100%] [&_select]:[font-family:inherit]

          [&_select]:text-[14px] [&_select]:font-normal [&_select]:tracking-[normal] [&_select]:normal-case">
        <Label className="tw-admin-field grid min-w-[140px] flex-[1_1_180px] gap-2 text-sm text-muted-foreground">
          Search name
          <Input className="tw-admin-input w-full" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Ada" />
        </Label>
        <Label className="tw-admin-field grid min-w-[140px] flex-[1_1_180px] gap-2 text-sm text-muted-foreground">
          Status
          <NativeSelect className="tw-admin-input w-full" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </NativeSelect>
        </Label>
        <Label className="tw-admin-check">
          <input type="checkbox" checked={noShow} onChange={(e) => setNoShow(e.target.checked)} /> Not arrived only
        </Label>
        <Button type="button" onClick={() => setPending({ kind: 'walk-in' })}>
          Add attendee
        </Button>
        <Button type="button" disabled={picked.length === 0} onClick={() => void sendRsvps()}>
          Send RSVP ({picked.length})
        </Button>
      </div>
      {message && (
        <Alert className={`flex items-start gap-[12px] m-[0px_0px_14px] p-[15px_17px] [border-width:1px] [border-style:solid]
                [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]
                [border-left-color:var(--line)] rounded-md [background:var(--card)] text-fg text-[13px]
                leading-[1.65] [overflow-wrap:anywhere]` + ' ' + (message.startsWith('✓') ? `[&&]:[border-color:color-mix(in_srgb,_var(--ok,_#4ade80)_40%,_var(--line))]
                [&&]:[background:color-mix(in_srgb,_#4ade80_6%,_var(--card))]` : message.startsWith('✕') ? `[&&]:[border-color:color-mix(in_srgb,_var(--bad,_#f87171)_40%,_var(--line))]
                [&&]:[background:color-mix(in_srgb,_#f87171_6%,_var(--card))]` : `[&&]:[border-color:color-mix(in_srgb,_var(--warn,_#fbbf24)_40%,_var(--line))]
                [&&]:[background:color-mix(in_srgb,_#fbbf24_6%,_var(--card))]`)} asChild role="status"><p  data-tone={message.startsWith('✓') ? 'ok' : message.startsWith('✕') ? 'bad' : 'warn'} role="status">
          {message}
        </p></Alert>
      )}

      {openId && <ParticipantDetail slug={slug} id={openId} onClose={() => setOpenId(null)} onChanged={load} />}

      {rows === null ? (
        <p>Loading…</p>
      ) : rows.length === 0 ? (
        <p className="tw-admin-muted text-muted-foreground text-[12px] leading-[1.7]">No participants match.</p>
      ) : (
        <div className="tw-admin-tableWrap overflow-x-auto [background:var(--card)] [border-width:1px] [border-style:solid]

          [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]

          [border-left-color:var(--line)] rounded-card shadow-panel max-[600.001px]:max-w-full">
          <Table className="tw-admin-table [&_.tw-admin-num]:text-right! [&_.tw-admin-actions]:flex [&_.tw-admin-actions]:items-center [&_.tw-admin-actions]:gap-1 [&_.tw-admin-actions_button]:px-2 [&_.tw-admin-actions_button]:text-xs [&_.tw-admin-badge]:text-xs">
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Label className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] cursor-pointer [&_input]:w-[20px]

          [&_input]:h-[20px]">
                    <input
                      type="checkbox"
                      aria-label="Select everyone shown who isn't accepted yet"
                      checked={invitable.length > 0 && picked.length === invitable.length}
                      onChange={(e) => setSelected(new Set(e.target.checked ? invitable.map((r) => r.id) : []))}
                    />
                  </Label>
                </TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Pass</TableHead>
                <TableHead>Arrived</TableHead>
                <TableHead className="tw-admin-num text-right! tabular-nums">Scans</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    {r.status !== 'accepted' && (
                      <Label className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] cursor-pointer [&_input]:w-[20px]

          [&_input]:h-[20px]">
                        <input type="checkbox" aria-label={`Select ${fullName(r)}`} checked={selected.has(r.id)} onChange={(e) => pick(r.id, e.target.checked)} />
                      </Label>
                    )}
                  </TableCell>
                  <TableCell>
                    {fullName(r)}
                    {r.isTest && <Badge className="tw-admin-badge inline-flex items-center justify-center w-[fit-content] p-[5px_9px] [border-width:1px]

          [border-style:solid] [border-top-color:var(--line)] [border-right-color:var(--line)]

          [border-bottom-color:var(--line)] [border-left-color:var(--line)] rounded-md

          [background:var(--raised)] text-fg text-[11px] font-semibold leading-[1.35] whitespace-nowrap
          max-w-full
 [font-family:inherit]"> TEST</Badge>}
                    {r.hasBadge && <> <Badge className="tw-admin-badge inline-flex items-center justify-center w-[fit-content] p-[5px_9px] [border-width:1px]

          [border-style:solid] [border-top-color:var(--line)] [border-right-color:var(--line)]

          [border-bottom-color:var(--line)] [border-left-color:var(--line)] rounded-md

          [background:var(--raised)] text-fg text-[11px] font-semibold leading-[1.35] whitespace-nowrap
          max-w-full
 [font-family:inherit]">Badge linked</Badge></>}
                  </TableCell>
                  <TableCell>{r.email}</TableCell>
                  <TableCell>
                    <Badge className={`tw-admin-badge inline-flex items-center justify-center w-[fit-content] p-[5px_9px] [border-width:1px] [border-style:solid] [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)] [border-left-color:var(--line)] rounded-md [background:var(--raised)] text-fg text-[11px] font-semibold leading-[1.35] whitespace-nowrap max-w-full [font-family:inherit] ${r.status === 'accepted' ? `tw-admin-badgeOk
                [&.tw-admin-badgeOk]:[border-color:color-mix(in_srgb,_var(--ok,_#4ade80)_40%,_var(--line))]
                [&.tw-admin-badgeOk]:[background:color-mix(in_srgb,_var(--ok,_#4ade80)_10%,_var(--card))]
                [&.tw-admin-badgeOk]:[color:var(--ok,_#4ade80)]` : r.status === 'withdrawn' || r.status === 'rejected' ? `tw-admin-badgeBad
                [&.tw-admin-badgeBad]:[border-color:color-mix(in_srgb,_var(--bad,_#f87171)_40%,_var(--line))]
                [&.tw-admin-badgeBad]:[background:color-mix(in_srgb,_var(--bad,_#f87171)_10%,_var(--card))]
                [&.tw-admin-badgeBad]:[color:var(--bad,_#f87171)]` : ''}`}>{r.status}</Badge>
                    {r.status === 'pending' && r.rsvpSentAt && <span className="tw-admin-muted text-muted-foreground text-[12px] leading-[1.7]"> · RSVP sent</span>}
                  </TableCell>
                  <TableCell>{r.passState === 'active' ? 'Active' : r.passState === 'revoked' ? 'Revoked' : '—'}</TableCell>
                  <TableCell>{r.checkedIn ? '✓ Checked in' : '—'}</TableCell>
                  <TableCell className="tw-admin-num text-right! tabular-nums">{r.liveScans}</TableCell>
                  <TableCell>
                    <div className="tw-admin-actions flex flex-nowrap gap-[6px]">
                      <Button type="button" variant="outline" aria-label={`Details for ${fullName(r)}`} onClick={() => setOpenId(r.id)}>
                        Details
                      </Button>
                      {r.status === 'accepted' && (
                        <Button type="button" variant="outline" onClick={() => setPending({ kind: 'resend', row: r })}>
                          Resend pass
                        </Button>
                      )}
                      {r.status === 'accepted' && nfc.supported && (
                        <Button
                          type="button"
                          variant="outline"
                          aria-label={`${r.hasBadge ? 'Replace' : 'Link'} badge for ${fullName(r)}`}
                          disabled={badgeBusy}
                          onClick={() => startLink(r)}
                        >
                          {r.hasBadge ? 'Replace badge' : 'Link badge'}
                        </Button>
                      )}
                      {r.hasBadge && (
                        <Button
                          type="button"
                          variant="outline"
                          aria-label={`Unlink badge for ${fullName(r)}`}
                          disabled={badgeBusy}
                          onClick={() => setPending({ kind: 'unlink', row: r })}
                        >
                          Unlink badge
                        </Button>
                      )}
                      {r.passState === 'active' && (
                        <Button type="button" variant="outline" onClick={() => setPending({ kind: 'revoke', row: r })}>
                          Revoke
                        </Button>
                      )}
                      {(r.status !== 'pending' || r.rsvpSentAt) && (
                        <Button type="button" variant="outline" onClick={() => setPending({ kind: 'revoke-rsvp', row: r })}>
                          Revoke RSVP
                        </Button>
                      )}
                      <Button type="button" variant="outline" aria-pressed={r.isTest} onClick={() => void toggleTest(r)}>
                        {r.isTest ? 'Unmark test' : 'Mark test'}
                      </Button>
                      <Button type="button" variant="ghost" className="tw-admin-danger text-destructive hover:bg-destructive/10" onClick={() => setPending({ kind: 'delete', row: r })}>
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {badgeTarget && (
        <Modal title="Link a badge" onCancel={cancelLink}>
          <p className="copy">Tap the badge to link it to {fullName(badgeTarget)}.</p>
          <div aria-live="polite">
            {badgeBusy ? <p>Linking badge…</p> : (badgeError || nfc.error) && <p className="flex items-start gap-[12px] m-[0px_0px_14px] p-[15px_17px] [border-width:1px] [border-style:solid]

          [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]

          [border-left-color:var(--line)] rounded-md [background:var(--card)] text-fg text-[13px]

          leading-[1.65] [overflow-wrap:anywhere]

          [&&]:[border-color:color-mix(in_srgb,_var(--bad,_#f87171)_40%,_var(--line))]

          [&&]:[background:color-mix(in_srgb,_#f87171_6%,_var(--card))]">{badgeError ?? nfc.error}</p>}
          </div>
          <div className="flex gap-[8px] justify-end flex-wrap mt-[8px] pt-[14px] [border-top-width:1px] [border-top-style:solid]

          [border-top-color:var(--line)] [&_button]:min-h-[44px] [&_button]:p-[8px_12px] [&_button]:rounded-md

          [&_button]:[font-family:inherit] [&_button]:text-[12px] [&_button]:font-semibold

          max-[480.001px]:[&_button]:flex-1">
            {/* After Chrome refused NFC (permission denied), this tap retries; the error names this button. */}
            {nfc.state === 'off' && !badgeBusy && (
              <Button type="button" onClick={() => void nfc.start()}>
                Start badge reader
              </Button>
            )}
            <Button type="button" variant="outline" onClick={cancelLink}>
              Cancel
            </Button>
          </div>
        </Modal>
      )}
      {pending?.kind === 'unlink' && (
        <ConfirmDialog
          title="Unlink this badge?"
          body={<p>{fullName(pending.row)}’s badge stops working (scans and profile) until staff link it again. The chip itself doesn’t change.</p>}
          confirmLabel="Unlink badge"
          danger
          onConfirm={() => void act('unlink', pending.row)}
          onCancel={() => setPending(null)}
        />
      )}
      {pending?.kind === 'resend' && (
        <ConfirmDialog
          title={`Resend pass to ${fullName(pending.row)}?`}
          body={<p className="copy">They’ll get a new email with a new code. Their old code will stop working.</p>}
          confirmLabel="Resend pass"
          onConfirm={() => void act('resend', pending.row)}
          onCancel={() => setPending(null)}
        />
      )}
      {pending?.kind === 'revoke' && (
        <ConfirmDialog
          title={`Revoke ${fullName(pending.row)}’s pass?`}
          body={<p className="copy">Their code will scan as “pass cancelled”. You can resend a new pass later.</p>}
          confirmLabel="Revoke pass"
          danger
          onConfirm={() => void act('revoke', pending.row)}
          onCancel={() => setPending(null)}
        />
      )}
      {pending?.kind === 'revoke-rsvp' && (
        <ConfirmDialog
          title={`Revoke ${fullName(pending.row)}’s RSVP?`}
          body={
            <p>
              Their invitation link stops working, any pass is cancelled and their badge unlinked. They go back to “not RSVPed yet”, so you can send a new RSVP.
              Their profile and account stay.
            </p>
          }
          confirmLabel="Revoke RSVP"
          danger
          onConfirm={() => void act('revoke-rsvp', pending.row)}
          onCancel={() => setPending(null)}
        />
      )}
      {pending?.kind === 'delete' && (
        <ConfirmDialog
          title={`Delete ${fullName(pending.row)}?`}
          body={<p className="copy">This removes their name, email and notes, and cancels their pass. Their scans stay in the totals. It can’t be undone.</p>}
          confirmLabel="Delete participant"
          danger
          typeToConfirm="DELETE"
          onConfirm={() => void act('delete', pending.row)}
          onCancel={() => setPending(null)}
        />
      )}
      {pending?.kind === 'walk-in' && (
        <WalkInDialog
          slug={slug}
          onDone={async (msg) => {
            setPending(null);
            setMessage(msg);
            await load();
          }}
          onCancel={() => setPending(null)}
        />
      )}
    </>
  );
}

// F12. "Check in now" records a manual door scan through record_scan(). "Not RSVPed yet" adds a pending
// applicant instead (v0.7.1): nothing is sent until an organizer presses Send RSVP.
function WalkInDialog(props: { slug: string; onDone: (message: string) => void; onCancel: () => void }) {
  const api = useApi();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [checkInNow, setCheckInNow] = useState(true);
  const [sendPass, setSendPass] = useState(false);
  const [notRsvped, setNotRsvped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const r = await api<{ code: string; scan?: { code?: string } }>(adminUrl(props.slug, '/participants'), {
      method: 'POST',
      body: notRsvped ? { firstName, lastName, email, notRsvped } : { firstName, lastName, email, checkInNow, sendPass },
    });
    setBusy(false);
    if (!r.ok) {
      const code = (r.data as { code?: string }).code;
      setError(code === 'CONFLICT_DUPLICATE_EMAIL' ? 'Someone in this event already uses that email.' : r.status === 400 ? 'Check the name and email.' : errorText(r));
      return;
    }
    const scanCode = r.data.scan?.code;
    props.onDone(
      notRsvped
        ? `✓ Added ${firstName} as not RSVPed yet. Tick them and press Send RSVP to email the invitation.`
        : !checkInNow || scanCode === 'ACCEPTED'
        ? `✓ Added ${firstName}${checkInNow ? ' and checked them in' : ''}.`
        : `! Added ${firstName}, but check-in failed (${scanCode ?? 'unknown'}). Is the door open?`,
    );
  }

  return (
    <Modal title="Add attendee" onCancel={props.onCancel}>
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
          First name
          <Input className="tw-admin-input w-full" required maxLength={100} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </Label>
        <Label className="tw-admin-field grid min-w-[140px] flex-[1_1_180px] gap-2 text-sm text-muted-foreground">
          Last name
          <Input className="tw-admin-input w-full" maxLength={100} value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </Label>
        <Label className="tw-admin-field grid min-w-[140px] flex-[1_1_180px] gap-2 text-sm text-muted-foreground">
          Email
          <Input className="tw-admin-input w-full" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Label>
        <Label className="tw-admin-check">
          <input type="checkbox" checked={notRsvped} onChange={(e) => setNotRsvped(e.target.checked)} /> Not RSVPed yet
        </Label>
        {notRsvped ? (
          <p className="copy tw-admin-muted text-muted-foreground text-[12px] leading-[1.7]">They’re added as an applicant and sent nothing. Send their RSVP from the list when you’re ready.</p>
        ) : (
          <>
            <Label className="tw-admin-check">
              <input type="checkbox" checked={checkInNow} onChange={(e) => setCheckInNow(e.target.checked)} /> Check in now
            </Label>
            <Label className="tw-admin-check">
              <input type="checkbox" checked={sendPass} onChange={(e) => setSendPass(e.target.checked)} /> Email them a pass
            </Label>
          </>
        )}
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
          <Button type="submit" disabled={busy}>
            Add attendee
          </Button>
        </div>
      </form>
    </Modal>
  );
}
