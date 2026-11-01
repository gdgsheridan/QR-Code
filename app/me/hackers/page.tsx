import Link from 'next/link';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { BrandMark } from '@/components/brand-mark';
import { Entrance } from '@/components/motion';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { PaceSlider } from '@/components/pace-slider';
import { directoryPace } from '@/components/pace-options';
import { db } from '@/lib/db/server';
import { PACE } from '@/lib/domain/profile';
import { DIRECTORY_MAX, DIRECTORY_PAGE, hackerDirectory, invitedByMyTeam } from '@/lib/me/hackers';
import { inviteTeammate, myTeam } from '@/lib/me/team';
import { emailFrom, getProvider } from '@/lib/email';
import { drainUntilIdle } from '@/lib/email/drain';
import { env } from '@/lib/env';
import { CopyButton } from '@/app/profile/[uid]/copy-button';
import { withinLimit } from '@/lib/pass/handlers';
import { loadMyEvent, menuMetadata } from '../load';
import { AutoFilters, RefreshButton } from './filters';
import { TeamsView } from './teams-view';

export const metadata = menuMetadata('Hackers');
const DIRECTORY_READS_PER_MIN = 60;

async function invite(formData: FormData) {
  'use server';
  const { me, user } = await loadMyEvent('/me/hackers');
  const inviteeId = String(formData.get('inviteeId') ?? '');
  const result = await inviteTeammate(db(), user, me.participantId, inviteeId);
  if (result === 'INVITED') after(() => drainUntilIdle({ db: db(), provider: getProvider(), appOrigin: env().NEXT_PUBLIC_APP_ORIGIN, from: emailFrom(), passSecret: env().PASS_TOKEN_SECRET }));
  // Back to the same filters and the invited card (only the directory's own keys are kept).
  const back = new URLSearchParams(String(formData.get('back') ?? ''));
  const next = new URLSearchParams();
  for (const key of FILTER_KEYS) { const value = back.get(key); if (value) next.set(key, value); }
  next.set('r', result);
  redirect(`/me/hackers?${next.toString()}${/^[0-9a-f-]{36}$/.test(inviteeId) ? `#h-${inviteeId}` : ''}`);
}

const FILTER_KEYS = ['q', 'looking', 'pace', 'track', 'show'] as const;

// A website shown by its domain ("aleksbrsc.com"), not its whole URL.
function siteLabel(url: string): string {
  try {
    const { host, pathname } = new URL(url);
    return host.replace(/^www\./, '') + (pathname === '/' ? '' : pathname);
  } catch {
    return url;
  }
}

const NOTICES: Record<string, string> = {
  INVITED: '✓ Invite sent. They can accept on their Team page.',
  ALREADY_INVITED: 'You’ve already invited them.',
  NOT_LOOKING: 'They’re no longer looking for a team.',
  SELF: 'You can’t invite yourself.',
  TEAM_FULL: 'Your team already has 4 people.',
  CLOSED: 'Team forming is closed.',
  NOT_FOUND: 'Something changed. Reload the page and try again.',
};

export default async function HackersPage({ searchParams }: { searchParams: Promise<{ view?: string; room?: string; q?: string; looking?: string; pace?: string; track?: string; r?: string; show?: string }> }) {
  const params = await searchParams;
  const { me, user, now } = await loadMyEvent('/me/hackers');
  const view = params.view === 'teams' ? 'teams' : 'hackers';
  const looking = params.looking === '1';
  const pace = directoryPace(params.pace);
  // v0.11.25: 50 at a time; Show more asks for 50 more (a plain link, so it works without JavaScript).
  const show = Math.min(Math.max(Math.floor(Number(params.show)) || DIRECTORY_PAGE, DIRECTORY_PAGE), DIRECTORY_MAX);
  // v0.11.25: filters apply as they change, so directory reads are limited per hacker (60 a minute).
  const allowed = await withinLimit(db(), `directory:${me.participantId}`, 60, DIRECTORY_READS_PER_MIN);
  // An unknown track id just matches nobody (the SQL checks it); the list below only offers this event's tracks.
  const track = params.track ?? '';
  const [{ people, more }, { team, tracks }, invited] = await Promise.all([
    allowed && view === 'hackers' ? hackerDirectory(db(), me, user.email ?? '', { looking, search: params.q ?? '', pace, track, show }) : Promise.resolve({ people: [], more: false }),
    view === 'hackers' ? myTeam(db(), me) : Promise.resolve({ team: null, tracks: [] }),
    view === 'hackers' ? invitedByMyTeam(db(), me) : Promise.resolve(new Set<string>()),
  ]);
  const back = new URLSearchParams();
  for (const key of FILTER_KEYS) { const value = params[key]; if (value) back.set(key, value); }
  const onlyLooking = looking && !params.q?.trim() && !pace && !track;
  const canInvite = me.event.teamsOpen && Date.parse(me.event.endsAt) > now.getTime() && team && team.members.length < 4;
  const notice = params.r ? NOTICES[params.r] : undefined;
  return <Entrance><main className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 pt-6 pb-14">
    <div className="flex min-h-11 items-center gap-4">
      <Link href="/me" className="inline-flex min-h-11 shrink-0 items-center font-semibold">← Menu</Link>
      <BrandMark name={me.event.name} className="max-w-[70%]" />
      <span aria-hidden="true" className="h-px min-w-3 flex-1 bg-[var(--edge)]" />
    </div>
    <h1>Hackers</h1>
    <nav aria-label="Directory sections" className="flex min-w-0 max-w-full gap-1 overflow-x-auto overflow-y-hidden">
      {([['hackers', 'Hackers'], ['teams', 'Teams']] as const).map(([value, label]) => <a key={value} href={value === 'teams' ? '/me/hackers?view=teams' : '/me/hackers'} aria-current={view === value ? 'page' : undefined}
        className="inline-flex min-h-12 shrink-0 items-center whitespace-nowrap rounded-t-lg border-b-2 border-transparent px-3 text-sm font-semibold text-muted-foreground no-underline hover:bg-accent/6 hover:text-fg focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-3 aria-[current=page]:border-accent aria-[current=page]:bg-accent/8 aria-[current=page]:text-accent aria-[current=page]:font-bold">
        {label}
      </a>)}
    </nav>
    {view === 'teams' ? <TeamsView me={me} params={params} allowed={allowed} /> : <>
    <Link href="/me/profile?tab=networking" className="inline-flex min-h-11 items-center self-start">Edit my directory profile →</Link>
    {/* Owner's request: the filters stack in one column. They apply as they change (v0.11.25). */}
    <AutoFilters className="grid max-w-[760px] gap-4">
      {/* Owner's request: search and track side by side (stacked on phones), the pace slider below them. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid min-w-0 gap-2"><Label htmlFor="search">Search by name</Label><Input id="search" name="q" type="search" defaultValue={params.q ?? ''} className="min-h-12 w-full" /></div>
        <div className="grid min-w-0 gap-2"><Label htmlFor="track">Track</Label><NativeSelect id="track" name="track" defaultValue={track} className="min-h-12 w-full">
          <option value="">All tracks</option>{tracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </NativeSelect></div>
      </div>
      <PaceSlider value={pace} filter />
      <Label className="flex min-h-11 items-center gap-3"><input className="size-[22px]" type="checkbox" name="looking" value="1" defaultChecked={looking} />Looking for a team</Label>
      <div className="flex flex-wrap gap-3 justify-self-start">
        <RefreshButton />
        {/* Without JavaScript the filters don't apply as they change. */}
        <noscript><Button type="submit">Apply</Button></noscript>
      </div>
    </AutoFilters>
    {notice && <p role={params.r === 'INVITED' ? 'status' : 'alert'}>{notice}</p>}
    {!allowed && <p role="alert">Too many refreshes. Wait a minute, then try again.</p>}
    <p className="m-0 text-sm text-muted-foreground">Pace bar: 1 = here to learn, 2 = balanced, 3 = going for the win.</p>
    {looking && !team && <p className="copy m-0 text-muted-foreground">Create a team to invite them. <Link className="inline-flex min-h-11 items-center" href="/me/team">Open Team →</Link></p>}
    <section aria-label="Hacker directory" className="grid items-start gap-3 min-[768px]:grid-cols-2 min-[1100px]:grid-cols-3 min-[1440px]:grid-cols-4">
      {allowed && people.length === 0 && <p className="copy text-muted-foreground col-span-full">{onlyLooking ? 'Nobody is looking for a team right now.' : 'No hackers match these filters.'}</p>}
      {people.map((person) => {
        const self = person.id === me.participantId;
        const full = 'bio' in person;
        const targetLooking = full ? person.looking && !person.teamName : looking;
        const paceLabel = full ? person.pace ? PACE[person.pace] : 'Pace not set' : 'Pace not shared';
        const paceLevel = full && person.pace ? { casual: 1, balanced: 2, competitive: 3 }[person.pace] : 0;
        const invitable = !self && targetLooking && canInvite;
        const paceDescription = `${paceLabel.startsWith('Pace ') ? paceLabel : `Pace: ${paceLabel}`} (${paceLevel} of 3)`;
        return <Card key={person.id} asChild className="min-w-0 gap-0 p-0 [overflow-wrap:anywhere]"><article id={`h-${person.id}`} aria-label={`${person.name}${self ? ' (you)' : ''}`}>
          <details className="group">
            <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-md px-4 py-3 hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
              <h2 className="m-0 min-w-0 flex-1 text-base font-semibold">{person.name}{self && <span className="text-sm font-normal text-muted-foreground"> (you)</span>}</h2>
              <span role="img" aria-label={paceDescription} title={paceDescription} className="flex h-2 w-[72px] shrink-0 gap-0.5">
                {['bg-accent', 'bg-[var(--warn)]', 'bg-[var(--bad)]'].map((color, index) => <span key={color} aria-hidden="true" className={`h-full flex-1 rounded-full ${index < paceLevel ? color : 'border border-dashed border-muted-foreground/50 bg-muted'}`} />)}
              </span>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4 shrink-0 text-muted-foreground group-open:rotate-180 motion-safe:transition-transform">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </summary>
            {/* Owner's request (v0.11.28): facts as label/value rows, then the bio, then contacts as one consistent group. */}
            <div className="grid gap-4 border-t border-border px-4 py-4">
              <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">Pace</dt>
                <dd className="m-0">{full ? person.pace ? PACE[person.pace] : 'Not set' : 'Not shared'}</dd>
                <dt className="text-muted-foreground">Team</dt>
                {/* Names-only rows only appear under the Looking filter. */}
                <dd className="m-0 [overflow-wrap:anywhere]">{full ? person.teamName ?? (person.looking ? 'Looking for a team' : 'Going solo') : 'Looking for a team'}</dd>
                {full && !person.teamName && person.tracks.length > 0 && <><dt className="text-muted-foreground">Wants to do</dt><dd className="m-0">{person.tracks.join(', ')}</dd></>}
              </dl>
              {full && person.bio && <p className="copy m-0 whitespace-pre-line">{person.bio}</p>}
              {full && !self && (person.linkedinUrl || person.websiteUrl || person.discord) && <div className="grid gap-2 border-t border-border pt-3">
                {(person.linkedinUrl || person.websiteUrl) && <div className="flex flex-wrap gap-2">
                  {person.linkedinUrl && <Button asChild variant="outline" size="sm"><a href={person.linkedinUrl} rel="nofollow ugc">LinkedIn ↗</a></Button>}
                  {person.websiteUrl && <Button asChild variant="outline" size="sm"><a href={person.websiteUrl} rel="nofollow ugc" className="max-w-full [overflow-wrap:anywhere]">{siteLabel(person.websiteUrl)} ↗</a></Button>}
                </div>}
                {person.discord && <div className="flex min-h-11 items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 [overflow-wrap:anywhere]"><span className="text-muted-foreground">Discord </span>@{person.discord}</span>
                  <CopyButton text={person.discord} label={`Copy ${person.name}’s Discord username`} />
                </div>}
              </div>}
            </div>
          </details>
          {/* Outside the summary (a button can't sit inside it), so it shows without expanding the card. */}
          {!self && invited.has(person.id)
            ? <p className="m-0 flex min-h-11 items-center px-4 pb-3 text-sm text-muted-foreground">✓ Invited</p>
            : invitable && <form action={invite} className="px-4 pb-3">
              <input type="hidden" name="inviteeId" value={person.id} />
              <input type="hidden" name="back" value={back.toString()} />
              <Button type="submit" variant="outline" aria-label={`Invite ${person.name}`}>Invite</Button>
            </form>}
        </article></Card>;
      })}
    </section>
    {more && show < DIRECTORY_MAX && (() => {
      const next = new URLSearchParams({ ...(params.q && { q: params.q }), ...(looking && { looking: '1' }), ...(pace && { pace }), ...(track && { track }), show: String(show + DIRECTORY_PAGE) });
      const firstNew = people.at(-1)?.id;
      return <Button variant="outline" className="self-center" asChild><Link href={`/me/hackers?${next.toString()}${firstNew ? `#h-${firstNew}` : ''}`} scroll={false}>Show more</Link></Button>;
    })()}
    </>}
  </main></Entrance>;
}
