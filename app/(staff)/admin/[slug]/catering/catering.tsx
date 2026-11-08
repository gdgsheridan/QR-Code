'use client';

import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

import { useCallback, useState } from 'react';
import type { CateringHacker as Hacker } from '@/lib/admin/catering';
import { dietaryBreakdown, dietaryGroups, noRestriction } from '@/lib/domain/dashboard';
import { toSearchText } from '@/lib/domain/normalize';
import { adminUrl, errorText, useApi, useLoad } from '../api';
import { DietaryChart } from '../dietary-chart';
import { ShareLink } from './share-link';
import { PageHeader } from '../page-header';

const SEVERITY_ORDER = ['severe', 'moderate', 'mild'];
const rank = (s: string | null) => (s && SEVERITY_ORDER.includes(s) ? SEVERITY_ORDER.indexOf(s) : SEVERITY_ORDER.length);
const plural = (n: number) => `${n} hacker${n === 1 ? '' : 's'}`;

// §11 (v0.11.39): the dietary chart, who is in each group, and allergies, for the accepted hackers.
export function Catering({ slug }: { slug: string }) {
  const api = useApi();
  const [data, setData] = useState<{ hackers: Hacker[]; shareUrl: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api<{ hackers: Hacker[]; shareUrl: string | null }>(adminUrl(slug, '/catering'));
    if (r.ok) setData(r.data);
    else if (r.status !== 401) setError(errorText(r));
  }, [api, slug]);
  useLoad(load);

  if (!data) return <p>{error ? `✕ ${error}` : 'Loading catering…'}</p>;
  return (
    <>
      <PageHeader title="Catering" description="Dietary groups and allergies of the accepted hackers.">
        <ShareLink slug={slug} shareUrl={data.shareUrl} onChange={(shareUrl) => setData({ ...data, shareUrl })} />
      </PageHeader>
      <CateringView hackers={data.hackers} />
    </>
  );
}

// Shared with the public page that the share link opens (app/catering/[slug]).
export function CateringView({ hackers }: { hackers: Hacker[] }) {
  const [query, setQuery] = useState('');
  const dietary = dietaryBreakdown(hackers.map((h) => h.dietaryNotes));
  const groups = dietary.groups.map(({ label }) => ({ label, people: hackers.filter((h) => dietaryGroups(h.dietaryNotes).includes(label)) }));
  const other = hackers.filter((h) => dietaryGroups(h.dietaryNotes).length === 0 && !noRestriction(h.dietaryNotes));
  const allergic = hackers.filter((h) => h.allergies).sort((a, b) => rank(a.allergySeverity) - rank(b.allergySeverity));
  // The search narrows the lists, never the chart (I-12: names compared through toSearchText).
  const needle = toSearchText(query);
  const found = (list: Hacker[]) => (needle ? list.filter((h) => toSearchText(h.name).includes(needle)) : list);
  const shownGroups = groups.map((g) => ({ ...g, shown: found(g.people) })).filter((g) => g.shown.length > 0);
  const shownOther = found(other);
  const shownAllergic = found(allergic);
  const noMatch = needle ? <p className="text-sm text-muted-foreground">Nobody here matches “{query.trim()}”.</p> : null;

  return (
    <>
      <DietaryChart dietary={dietary} />

      <h2>Who’s in each group</h2>
      <Label className="mb-[14px] grid max-w-[420px] gap-2 text-sm text-muted-foreground">
        Search by name
        <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Type a name" className="min-h-11 w-full" />
      </Label>
      {groups.length === 0 && other.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody has a dietary restriction yet.</p>
      ) : shownGroups.length === 0 && shownOther.length === 0 ? noMatch : (
        <div className="grid gap-[14px]">
          {shownGroups.map(({ label, people, shown }) => (
            <GroupCard key={label} label={label} count={people.length} shown={shown.length}>
              <ul className="m-0 list-none p-0 text-sm leading-7 [columns:13rem] [column-gap:24px] max-[600.001px]:[columns:8.5rem] max-[600.001px]:[column-gap:16px]">
                {shown.map((h, index) => <li key={`${h.name}-${index}`} className="break-inside-avoid">{h.name}</li>)}
              </ul>
            </GroupCard>
          ))}
          {shownOther.length > 0 && (
            <GroupCard label="Other" count={other.length} shown={shownOther.length}>
              <ul className="m-0 list-none p-0 text-sm leading-7 [columns:24rem] [column-gap:32px] [&>li]:break-inside-avoid">
                {shownOther.map((h, index) => (
                  <li key={`${h.name}-${index}`}><span className="font-semibold">{h.name}</span>: <span className="text-muted-foreground">{h.dietaryNotes}</span></li>
                ))}
              </ul>
            </GroupCard>
          )}
        </div>
      )}

      <h2>Allergies</h2>
      <p className="m-[0px_0px_14px] text-sm text-muted-foreground">From profile setup, separate from dietary notes. Volunteers also see them on meal scans.</p>
      {allergic.length === 0 ? (
        <p className="text-sm text-muted-foreground">No allergies reported.</p>
      ) : shownAllergic.length === 0 ? noMatch : (
        <div className="overflow-x-auto rounded-card border border-solid border-[var(--line)] [background:var(--card)] shadow-panel">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Allergy</TableHead>
                <TableHead>Severity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shownAllergic.map((h, index) => (
                <TableRow key={`${h.name}-${index}`}>
                  <TableCell className="font-semibold">{h.name}</TableCell>
                  <TableCell className="whitespace-normal">{h.allergies}</TableCell>
                  <TableCell className={`capitalize ${h.allergySeverity === 'severe' ? 'font-bold text-[var(--bad,_#f87171)]' : ''}`}>
                    {h.allergySeverity === 'severe' ? '⚠ Severe' : h.allergySeverity ?? '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}

function GroupCard({ label, count, shown, children }: { label: string; count: number; shown: number; children: React.ReactNode }) {
  const id = `group-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return (
    <Card asChild className="gap-2">
      <section aria-labelledby={id}>
        <div className="flex items-baseline justify-between gap-3">
          <h3 id={id} className="m-0 text-base font-semibold">{label}</h3>
          <span className="text-xs text-muted-foreground tabular-nums">{shown < count ? `${shown} of ${plural(count)}` : plural(count)}</span>
        </div>
        {children}
      </section>
    </Card>
  );
}
