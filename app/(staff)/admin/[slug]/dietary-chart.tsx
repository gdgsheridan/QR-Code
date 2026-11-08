import { Card } from '@/components/ui/card';
import type { DietaryBreakdown } from '@/lib/domain/dashboard';
import { niceScale } from './arrivals-chart';

// One share of accepted hackers; a few people out of hundreds still reads as more than nothing.
const share = (count: number, total: number) => {
  const p = Math.round((count / total) * 100);
  return p === 0 && count > 0 ? '<1%' : `${p}%`;
};
const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;
// The longest bar stops short of the edge, leaving room for its count (like the Team page's tracks chart).
const SPAN = 0.86;

// §11 (v0.11.36; on Catering since v0.11.39): accepted hackers' dietary restrictions by group, drawn like the Team page's Teams per track chart.
// Each row names its group and carries its count and share as text, never colour alone.
export function DietaryChart({ dietary }: { dietary: DietaryBreakdown }) {
  const { total, none, other, groups } = dietary;
  const rows = [
    ...groups.map((g) => ({ ...g, muted: false })),
    ...(other > 0 ? [{ label: 'Other', count: other, muted: false }] : []),
    ...(none > 0 ? [{ label: 'No restrictions', count: none, muted: true }] : []),
  ];
  const { max, ticks } = niceScale(Math.max(1, ...rows.map((r) => r.count)));
  const x = (n: number) => `${(n / max) * SPAN * 100}%`;

  return (
    <Card asChild className="grid gap-3 [&>p]:m-0">
      <section aria-labelledby="dietary-heading" data-testid="dietary-chart">
        <h2 id="dietary-heading" className="m-0 text-lg">Dietary restrictions</h2>
        {total === 0 ? (
          <p className="text-sm text-muted-foreground">No accepted hackers yet.</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Out of {plural(total, 'accepted hacker')}, from the dietary notes in the Sheet. A note can fall in more than one group, so the
              percentages can add up to more than 100%.
            </p>
            <div className="grid grid-cols-[minmax(4.5rem,9rem)_1fr] gap-x-3">
              {rows.map((r, row) => (
                <div key={r.label} role="group" aria-label={`${r.label}: ${plural(r.count, 'hacker')}, ${share(r.count, total)}`}
                  className="col-span-2 grid grid-cols-subgrid items-center">
                  <span className={`min-w-0 break-words text-sm font-semibold ${r.muted ? 'text-muted-foreground' : ''}`}>{r.label}</span>
                  <div className="relative flex min-h-12 items-center">
                    {/* Gridlines: recessive hairlines behind the bars, one per tick. */}
                    {ticks.map((tick) => (
                      <span key={tick} aria-hidden="true" className="absolute inset-y-0 w-px bg-border/60" style={{ left: x(tick) }} />
                    ))}
                    <span aria-hidden="true" className={`track-bar relative block h-5 rounded-r-[4px] ${r.muted ? 'bg-muted-foreground/60' : 'bg-accent'}`}
                      style={{ width: `max(2px, ${x(r.count)})`, transitionDelay: `${row * 50}ms` }} />
                    <span className="relative pl-2 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                      {r.count.toLocaleString('en-US')} · {share(r.count, total)}
                    </span>
                  </div>
                </div>
              ))}
              {/* The axis: tick values under the gridlines, then what they count. */}
              <div aria-hidden="true" className="relative col-start-2 mt-1 h-4 border-t border-border text-[11px] text-muted-foreground tabular-nums">
                {ticks.map((tick) => (
                  <span key={tick} className="absolute top-0.5 -translate-x-1/2" style={{ left: x(tick) }}>{tick.toLocaleString('en-US')}</span>
                ))}
              </div>
              <p aria-hidden="true" className="col-start-2 m-0 mt-1 text-[11px] text-muted-foreground">hackers</p>
              <p className="col-span-2 m-0 mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-3 w-3 rounded-[2px] bg-accent" />A restriction</span>
                {none > 0 && (
                  <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-3 w-3 rounded-[2px] bg-muted-foreground/60" />No restrictions</span>
                )}
              </p>
            </div>
          </>
        )}
      </section>
    </Card>
  );
}
