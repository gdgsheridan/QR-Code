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
    <section aria-label="Team directory" className="grid items-start gap-3 min-[768px]:grid-cols-2 min-[1100px]:grid-cols-3 min-[1440px]:grid-cols-4">
      {allowed && teams.length === 0 && <p className="copy text-muted-foreground col-span-full">{params.q || hasRoom || track ? 'No teams match' : 'No teams yet'}</p>}
      {teams.map((team) => <Card key={team.id} asChild className="min-w-0 [overflow-wrap:anywhere]"><article aria-label={`${team.name}${team.own ? ' (your team)' : ''}`}>
        <h2 className="m-0 text-base font-semibold">{team.name}{team.own && <span className="text-sm font-normal text-muted-foreground"> (your team)</span>}</h2>
        <p className="m-0">{team.count} of 4 members{team.spots > 0 && <> · {team.spots} spots left</>}</p>
        {team.track && <p className="m-0">Track: {team.track}</p>}
        <ul className="m-0 grid gap-1 pl-5">
          {team.members.map((member, index) => <li key={index}>{member.name}{member.self && ' (you)'}</li>)}
          {team.hidden > 0 && <li>+{team.hidden} more</li>}
        </ul>
        {!team.own && <p className="m-0 text-sm text-muted-foreground">Ask a member for the join code</p>}
      </article></Card>)}
    </section>
  </>;
}
