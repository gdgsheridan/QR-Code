'use client';

import { Alert } from '@/components/ui/alert';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

import { useCallback, useEffect, useState } from 'react';
import { formatEventDateTime } from '@/lib/domain/event-time';
import { adminUrl, errorText, useApi } from './api';
import { ArrivalsChart, type ArrivalBucket } from './arrivals-chart';
import { KIND_LABEL } from '@/app/(staff)/scan/[slug]/types';
import { PageHeader } from './page-header';

type Kind = 'door' | 'meal' | 'session' | 'custom';
interface DashboardData {
  event: { name: string; startsAt: string; endsAt: string; timezone: string };
  generatedAt: string;
  accepted: number;
  checkedIn: number;
  checkInRate: number;
  noShows: number;
  checkpoints: Array<{ id: string; name: string; kind: Kind; isOpen: boolean; capacity: number | null; liveScans: number; fill: number | null; uptake?: number | null }>;
  sessionRanking: Array<{ id: string; name: string; liveScans: number; capacity: number | null }>;
  arrivals: ArrivalBucket[];
  outbox: { pending: number; failed: number };
  alerts: { notFound: Array<{ staffUserId: string; displayName: string | null; count: number }> };
}

const POLL_MS = 10_000; // SPEC §11
const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${Math.round(n * 100)}%`);

export function Dashboard({ slug }: { slug: string }) {
  const api = useApi();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api<DashboardData>(adminUrl(slug, '/dashboard'));
    if (r.ok) {
      setData(r.data);
      setError(null);
    } else if (r.status !== 401) setError(errorText(r));
  }, [api, slug]);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_MS);
    const onVisible = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  if (!data) return <p>{error ? `✕ ${error}` : 'Loading dashboard…'}</p>;
  const tz = data.event.timezone;

  return (
    <>
      <PageHeader title="Dashboard" description="Live check-ins, meals and scans, refreshed every 10 seconds." />
      {error && (
        <Alert className="flex items-start gap-[12px] m-[0px_0px_14px] p-[15px_17px] [border-width:1px] [border-style:solid]

          [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]

          [border-left-color:var(--line)] rounded-md [background:var(--card)] text-fg text-[13px]

          leading-[1.65] [overflow-wrap:anywhere]

          [&&]:[border-color:color-mix(in_srgb,_var(--warn,_#fbbf24)_40%,_var(--line))]

          [&&]:[background:color-mix(in_srgb,_#fbbf24_6%,_var(--card))]" asChild role="status"><p  role="status">
          ! Couldn’t refresh: {error} Showing data from {formatEventDateTime(data.generatedAt, tz)}.
        </p></Alert>
      )}
      {data.alerts.notFound.map((a) => (
        <Alert className="flex items-start gap-[12px] m-[0px_0px_14px] p-[15px_17px] [border-width:1px] [border-style:solid]

          [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]

          [border-left-color:var(--line)] rounded-md [background:var(--card)] text-fg text-[13px]

          leading-[1.65] [overflow-wrap:anywhere]

          [&&]:[border-color:color-mix(in_srgb,_var(--bad,_#f87171)_40%,_var(--line))]

          [&&]:[background:color-mix(in_srgb,_#f87171_6%,_var(--card))]" asChild key={a.staffUserId}><p  role="alert">
          ⚠ {a.displayName ?? 'A staff member'} got {a.count} “unknown code” results in 5 minutes and is being rate-limited.
        </p></Alert>
      ))}
      {data.outbox.failed > 0 && (
        <Alert className="flex items-start gap-[12px] m-[0px_0px_14px] p-[15px_17px] [border-width:1px] [border-style:solid]

          [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]

          [border-left-color:var(--line)] rounded-md [background:var(--card)] text-fg text-[13px]

          leading-[1.65] [overflow-wrap:anywhere]

          [&&]:[border-color:color-mix(in_srgb,_var(--warn,_#fbbf24)_40%,_var(--line))]

          [&&]:[background:color-mix(in_srgb,_#fbbf24_6%,_var(--card))]" asChild><p  role="alert">
          ! {data.outbox.failed} pass email{data.outbox.failed === 1 ? '' : 's'} failed to send. Resend from Participants.
        </p></Alert>
      )}

      <div className="grid [grid-template-columns:repeat(auto-fit,_minmax(min(100%,_210px),_1fr))] gap-[14px]

          max-[600.001px]:[grid-template-columns:repeat(2,_minmax(0px,_1fr))] max-[600.001px]:gap-[10px]

          max-[360.001px]:[grid-template-columns:minmax(0px,_1fr)]">
        <Tile id="accepted" label="Accepted" value={data.accepted} />
        <Tile id="checked-in" label="Checked in" value={data.checkedIn} hint={`${pct(data.checkInRate)} of accepted`} />
        <Tile id="no-shows" label="Not arrived" value={data.noShows} />
        <Tile id="outbox" label="Emails pending" value={data.outbox.pending} hint={`${data.outbox.failed} failed`} />
      </div>

      <h2>Checkpoints</h2>
      <div className="tw-admin-tableWrap overflow-x-auto [background:var(--card)] [border-width:1px] [border-style:solid]

          [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]

          [border-left-color:var(--line)] rounded-card shadow-panel max-[600.001px]:max-w-full">
        <Table className="tw-admin-table [&_.tw-admin-num]:text-right! [&_.tw-admin-actions]:flex [&_.tw-admin-actions]:items-center [&_.tw-admin-actions]:gap-1 [&_.tw-admin-actions_button]:px-2 [&_.tw-admin-actions_button]:text-xs [&_.tw-admin-badge]:text-xs">
          <TableHeader>
            <TableRow>
              <TableHead>Checkpoint</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>State</TableHead>
              <TableHead className="tw-admin-num text-right! tabular-nums">Scans</TableHead>
              <TableHead className="tw-admin-num text-right! tabular-nums">Fill</TableHead>
              <TableHead className="tw-admin-num text-right! tabular-nums">Meal uptake</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.checkpoints.map((c) => (
              <TableRow key={c.id}>
                <TableCell>{c.name}</TableCell>
                <TableCell>{KIND_LABEL[c.kind].toLowerCase()}</TableCell>
                <TableCell>
                  <Badge className={`tw-admin-badge inline-flex items-center justify-center w-[fit-content] p-[5px_9px] [border-width:1px] [border-style:solid] [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)] [border-left-color:var(--line)] rounded-md [background:var(--raised)] text-fg text-[11px] font-semibold leading-[1.35] whitespace-nowrap max-w-full [font-family:inherit] ${c.isOpen ? `tw-admin-badgeOk
                [&.tw-admin-badgeOk]:[border-color:color-mix(in_srgb,_var(--ok,_#4ade80)_40%,_var(--line))]
                [&.tw-admin-badgeOk]:[background:color-mix(in_srgb,_var(--ok,_#4ade80)_10%,_var(--card))]
                [&.tw-admin-badgeOk]:[color:var(--ok,_#4ade80)]` : ''}`}>{c.isOpen ? '● Open' : '○ Closed'}</Badge>
                </TableCell>
                <TableCell className="tw-admin-num text-right! tabular-nums">
                  {c.liveScans}
                  {c.capacity ? ` / ${c.capacity}` : ''}
                </TableCell>
                <TableCell className="tw-admin-num text-right! tabular-nums">{pct(c.fill)}</TableCell>
                <TableCell className="tw-admin-num text-right! tabular-nums">{c.kind === 'meal' ? pct(c.uptake) : '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <h2>Check-ins</h2>
      <ArrivalsChart buckets={data.arrivals} timezone={data.event.timezone} />

      {data.sessionRanking.length > 0 && (
        <>
          <h2>Session attendance</h2>
          <div className="tw-admin-tableWrap overflow-x-auto [background:var(--card)] [border-width:1px] [border-style:solid]

          [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]

          [border-left-color:var(--line)] rounded-card shadow-panel max-[600.001px]:max-w-full">
            <Table className="tw-admin-table [&_.tw-admin-num]:text-right! [&_.tw-admin-actions]:flex [&_.tw-admin-actions]:items-center [&_.tw-admin-actions]:gap-1 [&_.tw-admin-actions_button]:px-2 [&_.tw-admin-actions_button]:text-xs [&_.tw-admin-badge]:text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead>Session</TableHead>
                  <TableHead className="tw-admin-num text-right! tabular-nums">Attended</TableHead>
                  <TableHead className="tw-admin-num text-right! tabular-nums">Capacity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.sessionRanking.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{s.name}</TableCell>
                    <TableCell className="tw-admin-num text-right! tabular-nums">{s.liveScans}</TableCell>
                    <TableCell className="tw-admin-num text-right! tabular-nums">{s.capacity ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <p className="tw-admin-muted text-muted-foreground text-[12px] leading-[1.7]">Updated {formatEventDateTime(data.generatedAt, tz)} · refreshes every 10 s</p>
    </>
  );
}

export function Tile(props: { id: string; label: string; value: number; hint?: string }) {
  return (
    <div className="tw-admin-tile

          [background:var(--surface)]

          [border-width:1px] [border-style:solid] [border-top-color:var(--line)] [border-right-color:var(--line)]

          [border-bottom-color:var(--line)] [border-left-color:var(--line)] rounded-card p-[20px] relative flex

          flex-col items-start min-w-0 min-h-[150px] overflow-hidden shadow-panel

          [transition:border-color_180ms_var(--ease),_transform_180ms_var(--ease)] max-[600.001px]:p-[16px_14px]

          max-[600.001px]:min-h-[132px]

          [&:hover]:[border-color:color-mix(in_srgb,_var(--accent)_40%,_var(--line))]

          [&:hover]:[transform:translateY(-2px)]" data-testid={`kpi-${props.id}`}>
      <span className="block text-[11px] text-muted-foreground font-semibold tracking-[0.11em] leading-[1.5] uppercase">{props.label}</span>
      <span className="block text-[clamp(34px,_3.5vw,_44px)] font-bold tabular-nums mt-[20px] text-fg tracking-[-0.055em]

          leading-[1] max-[600.001px]:text-[34px] max-[600.001px]:mt-[16px]">{props.value.toLocaleString('en-US')}</span>
      {props.hint && <span className="block text-[12px] text-muted-foreground mt-[12px] leading-[1.5]">{props.hint}</span>}
    </div>
  );
}
