'use client';

import { useEffect, useState } from 'react';

export interface ChartTrack {
  key: string;
  name: string;
  unassigned: boolean;
  teams: Array<{ id: string; name: string; members: number; mine: boolean }>;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
// The longest bar stops short of the edge, leaving room for its count.
const SPAN = 0.86;
const STRIPES = '[background-image:repeating-linear-gradient(135deg,transparent_0_3px,rgb(0_0_0/0.35)_3px_5px)]';

// v0.11.29 (owner's request): Team page Tracks, a stacked bar chart. A bar is a track's hackers; each block is a team,
// and hovering, tapping or focusing a block shows that team. Blocks are buttons with spoken names, so the data
// still reads (and the server HTML carries it) without JavaScript.
export function TracksChart({ tracks }: { tracks: ChartTrack[] }) {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (!active) return;
    const close = (event: KeyboardEvent | PointerEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !(event.target as Element).closest('[data-team-block]')) setActive(null);
    };
    document.addEventListener('keydown', close);
    document.addEventListener('pointerdown', close);
    return () => { document.removeEventListener('keydown', close); document.removeEventListener('pointerdown', close); };
  }, [active]);

  const hackers = (track: ChartTrack) => track.teams.reduce((n, team) => n + team.members, 0);
  const most = Math.max(1, ...tracks.map(hackers));
  const step = most <= 8 ? 1 : most <= 20 ? 2 : most <= 50 ? 5 : 10;
  const ticks = Array.from({ length: Math.floor(most / step) + 1 }, (_, i) => i * step);
  const x = (n: number) => `${(n / most) * SPAN * 100}%`;

  return (
    <div className="grid select-none grid-cols-[minmax(4.5rem,9rem)_1fr] gap-x-3">
      {tracks.map((track, row) => {
        const total = hackers(track);
        let before = 0;
        return (
          <div key={track.key} role="group" className="col-span-2 grid grid-cols-subgrid items-center"
            aria-label={`${track.name}: ${track.teams.length === 0 ? 'No teams yet' : `${plural(track.teams.length, 'team')} · ${plural(total, 'hacker')}`}`}>
            <span className={`min-w-0 break-words text-sm font-semibold ${track.unassigned ? 'text-muted-foreground' : ''}`}>{track.name}</span>
            <div className="relative flex min-h-12 items-center">
              {/* Gridlines: recessive hairlines behind the bars, one per tick. */}
              {ticks.map((tick) => (
                <span key={tick} aria-hidden="true" className="absolute inset-y-0 w-px bg-border/60" style={{ left: x(tick) }} />
              ))}
              {track.teams.length === 0 ? (
                <span className="relative pl-2 text-xs text-muted-foreground">No teams yet</span>
              ) : (
                <>
                  <span className="track-bar relative flex h-5 gap-[2px]" style={{ width: `max(${x(total)}, ${track.teams.length * 18}px)`, transitionDelay: `${row * 50}ms` }}>
                    {track.teams.map((team) => {
                      const id = `${track.key}:${team.id}`;
                      const centre = (before + team.members / 2) / most;
                      before += team.members;
                      const label = `${team.name} · ${plural(team.members, 'member')}${team.mine ? ' (your team)' : ''}`;
                      const align = centre < 0.25 ? 'left-0' : centre > 0.6 ? 'right-0' : 'left-1/2 -translate-x-1/2';
                      return (
                        <button key={team.id} type="button" data-team-block="" aria-label={label} aria-describedby={active === id ? `tip-${id}` : undefined}
                          style={{ flexGrow: team.members }}
                          onPointerEnter={(e) => { if (e.pointerType === 'mouse') setActive(id); }}
                          onPointerLeave={(e) => { if (e.pointerType === 'mouse') setActive((a) => (a === id ? null : a)); }}
                          onFocus={() => setActive(id)} onBlur={() => setActive((a) => (a === id ? null : a))}
                          onClick={() => setActive(id)}
                          className={`group relative -my-3 min-w-4 basis-0 cursor-pointer appearance-none border-0 bg-transparent px-0 py-3 last:[&>span]:rounded-r-[4px] focus-visible:outline-none
                            [&:focus-visible>span]:outline-2 [&:focus-visible>span]:outline-offset-2 [&:focus-visible>span]:outline-fg`}>
                          <span className={`block h-5 transition-[filter] duration-150 group-hover:brightness-125 ${track.unassigned ? 'bg-muted-foreground/60' : 'bg-accent'}
                            ${team.mine ? STRIPES : ''} ${active === id ? 'brightness-125' : ''}`} />
                          {active === id && (
                            <span role="tooltip" id={`tip-${id}`}
                              className={`tracks-tip absolute bottom-full z-10 mb-1 grid whitespace-nowrap rounded-md border border-border bg-[var(--card)] px-3 py-2
                                text-left text-xs shadow-panel ${align}`}>
                              <strong className="text-sm text-fg">{team.name}</strong>
                              <span className="text-muted-foreground">{plural(team.members, 'member')} · {track.name}</span>
                              {team.mine && <span className="text-accent">Your team</span>}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </span>
                  <span aria-hidden="true" className="relative pl-2 text-xs text-muted-foreground tabular-nums">{total}</span>
                </>
              )}
            </div>
          </div>
        );
      })}
      {/* The axis: tick values under the gridlines, then what they count. */}
      <div aria-hidden="true" className="relative col-start-2 mt-1 h-4 border-t border-border text-[11px] text-muted-foreground tabular-nums">
        {ticks.map((tick) => (
          <span key={tick} className="absolute top-0.5 -translate-x-1/2" style={{ left: x(tick) }}>{tick}</span>
        ))}
      </div>
      <p aria-hidden="true" className="col-start-2 m-0 mt-1 text-[11px] text-muted-foreground">hackers</p>
      <p className="col-span-2 m-0 mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-3 w-3 rounded-[2px] bg-accent" />A team</span>
        <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className={`h-3 w-3 rounded-[2px] bg-accent ${STRIPES}`} />Your team</span>
        {tracks.some((t) => t.unassigned) && (
          <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-3 w-3 rounded-[2px] bg-muted-foreground/60" />No track yet</span>
        )}
      </p>
    </div>
  );
}
