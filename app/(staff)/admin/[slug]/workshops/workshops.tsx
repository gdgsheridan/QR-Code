'use client';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { adminUrl, errorText, useApi } from '../api';
import { BucketChart } from '../arrivals-chart';
import { CheckpointPeople, PeopleToggle } from '../checkpoints/checkpoints';
import { Tile } from '../dashboard';
import { PageHeader } from '../page-header';

interface WorkshopData {
  timezone: string;
  checkedIn: number;
  attendees: number;
  checkIns: number;
  cooldownMinutes: number;
  cooldownRefusals: number;
  distribution: [number, number, number, number];
  workshops: Array<{ id: string; name: string; isOpen: boolean; capacity: number | null; attendees: number; fill: number | null }>;
  buckets: Array<{ bucketUtc: string; label: string; count: number }>;
}

const POLL_MS = 10_000;
const pct = (n: number | null) => (n === null ? '—' : `${Math.round(n * 100)}%`);
const BUCKETS = ['No workshops', '1 workshop', '2 workshops', '3 or more'] as const;
const wrap = `tw-admin-tableWrap overflow-x-auto [background:var(--card)] [border-width:1px] [border-style:solid]
  [border-color:var(--line)] rounded-card shadow-panel max-[600.001px]:max-w-full`;

// SPEC §13: attendance per workshop (session checkpoints), how many workshops each checked-in hacker went to,
// taps the cooldown refused, and check-ins over time. People lists who attended each one; the CSV (on Tools) has them all.
export function Workshops({ slug }: { slug: string }) {
  const api = useApi();
  const [data, setData] = useState<WorkshopData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [peopleOpen, setPeopleOpen] = useState<string | null>(null); // the workshop whose People list is open

  const load = useCallback(async () => {
    const r = await api<WorkshopData>(adminUrl(slug, '/analytics/workshops'));
    if (r.ok) {
      setData(r.data);
      setError(null);
    } else if (r.status !== 401) setError(errorText(r));
  }, [api, slug]);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const t = setInterval(() => document.visibilityState === 'visible' && void load(), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

  if (!data) return <p>{error ? `✕ ${error}` : 'Loading workshops…'}</p>;
  const peak = Math.max(1, ...data.distribution);
  // Of the checked-in hackers, so it can't pass 100% when a workshop doesn't require check-in.
  const share = data.checkedIn ? (data.checkedIn - data.distribution[0]) / data.checkedIn : null;

  return (
    <>
      <PageHeader title="Workshops" description="Who went to each workshop, and how many each hacker attended." />
      {error && (
        <Alert className="text-[13px]" asChild>
          <p role="status">! Couldn’t refresh: {error}</p>
        </Alert>
      )}
      <div className="grid [grid-template-columns:repeat(auto-fit,_minmax(min(100%,_210px),_1fr))] gap-[14px]
          max-[600.001px]:[grid-template-columns:repeat(2,_minmax(0px,_1fr))] max-[600.001px]:gap-[10px]
          max-[360.001px]:[grid-template-columns:minmax(0px,_1fr)]">
        <Tile id="ws-attendees" label="Went to a workshop" value={data.attendees} hint={`${pct(share)} of checked-in hackers`} />
        <Tile id="ws-checkins" label="Workshop check-ins" value={data.checkIns} hint={`across ${data.workshops.length} ${data.workshops.length === 1 ? 'workshop' : 'workshops'}`} />
        <Tile id="ws-none" label="Checked in, no workshop" value={data.distribution[0]} />
        <Tile
          id="ws-cooldown"
          label="Cooldown refusals"
          value={data.cooldownRefusals}
          hint={data.cooldownMinutes > 0 ? `${data.cooldownMinutes} min between workshops (Info tab)` : 'Cooldown is off (Info tab)'}
        />
      </div>

      <h2>Attendance by workshop</h2>
      {data.workshops.length === 0 ? (
        <p className="text-muted-foreground text-[13px]">No workshops yet. Add a checkpoint of kind “session” on the Checkpoints tab.</p>
      ) : (
        <div className={wrap}>
          <Table className="tw-admin-table [&_.tw-admin-num]:text-right!">
            <TableHeader>
              <TableRow>
                <TableHead>Workshop</TableHead>
                <TableHead>State</TableHead>
                <TableHead className="tw-admin-num text-right! tabular-nums">Attended</TableHead>
                <TableHead className="tw-admin-num text-right! tabular-nums">Capacity</TableHead>
                <TableHead className="min-w-[160px]">Fill</TableHead>
                <TableHead>Who attended</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.workshops.map((w) => (
                <Fragment key={w.id}>
                <TableRow>
                  <TableCell className="[overflow-wrap:anywhere]">{w.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[11px]">{w.isOpen ? '● Open' : '○ Closed'}</Badge>
                  </TableCell>
                  <TableCell className="tw-admin-num text-right! tabular-nums">{w.attendees}</TableCell>
                  <TableCell className="tw-admin-num text-right! tabular-nums">{w.capacity ?? '—'}</TableCell>
                  <TableCell>
                    {w.fill === null ? (
                      <span className="text-muted-foreground">No cap</span>
                    ) : (
                      <span className="flex items-center gap-[8px]">
                        <span aria-hidden="true" className="relative h-[8px] flex-1 min-w-[80px] rounded-full [background:var(--raised)] overflow-hidden">
                          <span className="absolute inset-y-0 left-0 rounded-full [background:var(--accent)]" style={{ width: `${Math.min(100, w.fill * 100)}%` }} />
                        </span>
                        <span className="tabular-nums">{pct(w.fill)}</span>
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <PeopleToggle name={w.name} open={peopleOpen === w.id} controls={`people-${w.id}`} onToggle={() => setPeopleOpen((o) => (o === w.id ? null : w.id))} />
                  </TableCell>
                </TableRow>
                {peopleOpen === w.id && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={6} className="p-0">
                      <CheckpointPeople id={`people-${w.id}`} slug={slug} checkpoint={w} timezone={data.timezone} />
                    </TableCell>
                  </TableRow>
                )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <h2>Workshops per checked-in hacker</h2>
      <ul aria-label="Checked-in hackers by number of workshops attended" className="m-0 p-[20px] list-none grid gap-[12px] [background:var(--surface)] [border-width:1px] [border-style:solid] [border-color:var(--line)] rounded-ticket shadow-panel">
        {data.distribution.map((n, i) => (
          <li key={BUCKETS[i]} className="grid [grid-template-columns:minmax(96px,_140px)_1fr_auto] items-center gap-[12px] text-[13px]">
            <span>{BUCKETS[i]}</span>
            <span aria-hidden="true" className="relative h-[14px] rounded-[4px] [background:var(--raised)] overflow-hidden">
              {n > 0 && <span className="absolute inset-y-0 left-0 rounded-r-[4px] [background:var(--accent)]" style={{ width: `${(n / peak) * 100}%` }} />}
            </span>
            <span className="tabular-nums text-right min-w-[88px]">
              {n} <span className="text-muted-foreground">({pct(data.checkedIn ? n / data.checkedIn : null)})</span>
            </span>
          </li>
        ))}
      </ul>

      <h2>Workshop check-ins</h2>
      <BucketChart
        buckets={data.buckets}
        timezone={data.timezone}
        minutes={15}
        noun={['check-in', 'check-ins']}
        title="Workshop check-ins"
        column="Check-ins"
        empty="No workshop check-ins yet."
      />
      <p className="text-muted-foreground text-[12px] leading-[1.7]">Refreshes every 10 s. Test and deleted participants and voided scans are left out.</p>
    </>
  );
}
