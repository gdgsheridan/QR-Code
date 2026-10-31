import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { db } from '@/lib/db/server';
import type { MyEvent } from '@/lib/me/profile';
import { teamLookup } from '@/lib/me/team-lookup';
import { AutoFilters, RefreshButton } from './filters';

export async function TeamsView({ me, params, allowed }: {
  me: MyEvent; params: { q?: string; room?: string; track?: string }; allowed: boolean;
}) {
  const hasRoom = params.room === '1';
  const track = me.event.tracksReleased ? params.track ?? '' : '';
  const { teams, tracks } = allowed
    ? await teamLookup(db(), me, { search: params.q ?? '', hasRoom, track })
    : { teams: [], tracks: [] };
  return <>
    <AutoFilters label="Filter teams" className="grid max-w-[760px] gap-4">
      <input type="hidden" name="view" value="teams" />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid min-w-0 gap-2"><Label htmlFor="team-search">Search by team name</Label><Input id="team-search" name="q" type="search" defaultValue={params.q ?? ''} className="min-h-12 w-full" /></div>
        {me.event.tracksReleased && <div className="grid min-w-0 gap-2"><Label htmlFor="team-track">Track</Label><NativeSelect id="team-track" name="track" defaultValue={track} className="min-h-12 w-full">
          <option value="">All tracks</option>{tracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </NativeSelect></div>}
      </div>
      <Label className="flex min-h-11 items-center gap-3"><input className="size-[22px]" type="checkbox" name="room" value="1" defaultChecked={hasRoom} />Has room</Label>
      <div className="justify-self-start"><RefreshButton /></div>
    </AutoFilters>
    {!allowed && <p role="alert">Too many refreshes. Wait a minute, then try again.</p>}
    <section aria-label="Team directory" className="grid items-stretch gap-3 min-[768px]:grid-cols-2 min-[1100px]:grid-cols-3 min-[1440px]:grid-cols-4">
      {allowed && teams.length === 0 && <p className="copy text-muted-foreground col-span-full">{params.q || hasRoom || track ? 'No teams match' : 'No teams yet'}</p>}
      {teams.map((team) => <Card key={team.id} asChild className={`flex min-w-0 flex-col gap-5 p-5 [overflow-wrap:anywhere] ${team.own ? 'border-accent/40' : ''}`}><article aria-label={`${team.name}${team.own ? ' (your team)' : ''}`}>
        <header className="grid gap-2">
          <div className="flex items-start justify-between gap-3">
            <h2 className="m-0 min-w-0 text-lg font-bold">{team.name}</h2>
            {team.own && <span className="shrink-0 rounded-full bg-accent/10 px-2 py-1 text-xs font-semibold text-accent">Your team</span>}
          </div>
          {me.event.tracksReleased && (team.track
            ? <span className="max-w-full justify-self-start rounded-full border border-border px-2 py-1 text-xs">{team.track}</span>
            : <p className="m-0 text-sm text-muted-foreground">No track yet</p>)}
        </header>
        <div className="grid gap-2">
          <div aria-hidden="true" className="flex h-2 gap-1">
            {[0, 1, 2, 3].map((seat) => <span key={seat} className={`h-full flex-1 rounded-full ${seat < team.count ? 'bg-accent' : 'border border-dashed border-muted-foreground/50 bg-muted'}`} />)}
          </div>
          <p className="m-0 text-sm text-muted-foreground">{team.count} of 4 members · {team.spots > 0 ? `${team.spots} ${team.spots === 1 ? 'spot' : 'spots'} left` : 'Full'}</p>
        </div>
        <ul className="m-0 grid list-none gap-3 p-0">
          {team.members.map((member, index) => <li key={index} className="flex items-center gap-3">
            <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-semibold text-accent">{member.name.trim().split(/\s+/).map((part) => Array.from(part)[0]).slice(0, 2).join('').toUpperCase()}</span>
            <span className="min-w-0 text-sm">{member.name}{member.self && <span className="text-muted-foreground"> (you)</span>}</span>
          </li>)}
          {team.hidden > 0 && <li className="flex items-center gap-3 text-sm text-muted-foreground">
            <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full border border-dashed border-muted-foreground/50 text-xs">+{team.hidden}</span>
            <span className="min-w-0">+{team.hidden} more</span>
          </li>}
        </ul>
        <footer className="mt-auto border-t border-border pt-3 text-sm">
          {team.own
            ? <Link href="/me/team" className="inline-flex min-h-11 items-center rounded-sm text-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">Open my team →</Link>
            : <p className="m-0 flex min-h-11 items-center text-muted-foreground">{team.spots > 0 ? 'Ask a member for the join code' : 'This team is full'}</p>}
        </footer>
      </article></Card>)}
    </section>
  </>;
}
