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
import { db } from '@/lib/db/server';
import { PACE } from '@/lib/domain/profile';
import { hackerDirectory } from '@/lib/me/hackers';
import { inviteTeammate, myTeam } from '@/lib/me/team';
import { emailFrom, getProvider } from '@/lib/email';
import { drainUntilIdle } from '@/lib/email/drain';
import { env } from '@/lib/env';
import { CopyButton } from '@/app/profile/[uid]/copy-button';
import { loadMyEvent, menuMetadata } from '../load';

export const metadata = menuMetadata('Hackers');

async function invite(formData: FormData) {
  'use server';
  const { me, user } = await loadMyEvent('/me/hackers');
  const result = await inviteTeammate(db(), user, me.participantId, String(formData.get('inviteeId') ?? ''));
  if (result === 'INVITED') after(() => drainUntilIdle({ db: db(), provider: getProvider(), appOrigin: env().NEXT_PUBLIC_APP_ORIGIN, from: emailFrom(), passSecret: env().PASS_TOKEN_SECRET }));
  redirect(`/me/hackers?looking=1&r=${result}`);
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

export default async function HackersPage({ searchParams }: { searchParams: Promise<{ q?: string; looking?: string; pace?: string; r?: string }> }) {
  const params = await searchParams;
  const { me, user, now } = await loadMyEvent('/me/hackers');
  const looking = params.looking === '1';
  const pace = params.pace && Object.hasOwn(PACE, params.pace) ? params.pace : '';
  const [people, { team }] = await Promise.all([
    hackerDirectory(db(), me, user.email ?? '', { looking, search: params.q ?? '', pace }),
    myTeam(db(), me),
  ]);
  const canInvite = me.event.teamsOpen && Date.parse(me.event.endsAt) > now.getTime() && team && team.members.length < 4;
  const notice = params.r ? NOTICES[params.r] : undefined;
  return <Entrance><main className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 pt-6 pb-14">
    <div className="flex min-h-11 items-center gap-4">
      <Link href="/me" className="inline-flex min-h-11 shrink-0 items-center font-semibold">← Menu</Link>
      <BrandMark name={me.event.name} className="max-w-[70%]" />
      <span aria-hidden="true" className="h-px min-w-3 flex-1 bg-[var(--edge)]" />
    </div>
    <h1>Hackers</h1>
    <Link href="/me/profile#networking" className="inline-flex min-h-11 items-center self-start">Edit my directory profile →</Link>
    <form className="grid items-end gap-4 sm:grid-cols-[1fr_1fr_auto]" aria-label="Filter hackers" action="/me/hackers">
      <div className="grid gap-2"><Label htmlFor="search">Search by name</Label><Input id="search" name="q" type="search" defaultValue={params.q ?? ''} className="min-h-12 w-full" /></div>
      <div className="grid gap-2"><Label htmlFor="pace">Pace</Label><NativeSelect id="pace" name="pace" aria-describedby="pace-legend" defaultValue={pace} className="min-h-12 w-full">
        <option value="">All paces</option>{Object.entries(PACE).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </NativeSelect></div>
      <Button type="submit">Apply filters</Button>
      <div className="flex flex-wrap items-center justify-between gap-x-4 sm:col-span-3">
        <Label className="flex min-h-11 items-center gap-3"><input className="size-[22px]" type="checkbox" name="looking" value="1" defaultChecked={looking} />Looking for a team</Label>
        <p id="pace-legend" className="m-0 text-xs text-muted-foreground">Pace bar: learn → win · 1–3 segments</p>
      </div>
    </form>
    {notice && <p role={params.r === 'INVITED' ? 'status' : 'alert'}>{notice}</p>}
    {looking && !team && <p className="copy m-0 text-muted-foreground">Create a team to invite them. <Link href="/me/team">Open Team →</Link></p>}
    <section aria-label="Hacker directory" className="grid items-start gap-3 min-[768px]:grid-cols-2 min-[1100px]:grid-cols-3 min-[1440px]:grid-cols-4">
      {people.length === 0 && <p className="copy text-muted-foreground col-span-full">No hackers match these filters.</p>}
      {people.map((person) => {
        const self = person.id === me.participantId;
        const full = 'bio' in person;
        const targetLooking = full ? person.looking && !person.teamName : looking;
        const paceLabel = full ? person.pace ? PACE[person.pace] : 'Pace not set' : 'Pace not shared';
        const paceLevel = full && person.pace ? { casual: 1, balanced: 2, competitive: 3 }[person.pace] : 0;
        const paceDescription = `${paceLabel.startsWith('Pace ') ? paceLabel : `Pace: ${paceLabel}`} (${paceLevel} of 3)`;
        return <Card key={person.id} asChild className="min-w-0 gap-0 p-0 [overflow-wrap:anywhere]"><article aria-label={`${person.name}${self ? ' (you)' : ''}`}>
          <details className="group">
            <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-md px-4 py-3 hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
              <h2 className="m-0 min-w-0 flex-1 text-base font-semibold">{person.name}{self && <span className="text-sm font-normal text-muted-foreground"> (you)</span>}</h2>
              <span role="img" aria-label={paceDescription} title={paceDescription} className="flex h-2 w-[72px] shrink-0 gap-0.5 overflow-hidden rounded-full">
                {['bg-accent', 'bg-[var(--warn)]', 'bg-[var(--bad)]'].map((color, index) => <span key={color} aria-hidden="true" className={`h-full flex-1 ${index < paceLevel ? color : 'rounded-sm border border-dashed border-muted-foreground/50 bg-muted'}`} />)}
              </span>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4 shrink-0 text-muted-foreground group-open:rotate-180 motion-safe:transition-transform">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </summary>
            <div className="grid gap-3 border-t border-border px-4 py-4">
              <p className="m-0 text-sm text-muted-foreground">{paceLabel}</p>
              {full && <>
                <p className="copy m-0 text-sm text-muted-foreground">{person.teamName ? `In a team: ${person.teamName}` : person.looking ? 'Looking for a team' : 'Going solo'}</p>
                {person.bio && <p className="copy m-0 whitespace-pre-line">{person.bio}</p>}
                {!self && <div className="grid gap-1">
                  {person.linkedinUrl && <a className="inline-flex min-h-11 items-center" href={person.linkedinUrl} rel="nofollow ugc">LinkedIn →</a>}
                  {person.discord && <div className="flex min-h-11 flex-wrap items-center gap-3"><span className="min-w-0 flex-1">Discord: @{person.discord}</span><CopyButton text={person.discord} label={`Copy ${person.name}’s Discord username`} /></div>}
                  {person.websiteUrl && <a className="inline-flex min-h-11 items-center" href={person.websiteUrl} rel="nofollow ugc">{person.websiteUrl} →</a>}
                </div>}
              </>}
              {!self && targetLooking && canInvite && <form action={invite}>
                <input type="hidden" name="inviteeId" value={person.id} />
                <Button type="submit" variant="outline" aria-label={`Invite ${person.name}`}>Invite</Button>
              </form>}
            </div>
          </details>
        </article></Card>;
      })}
    </section>
  </main></Entrance>;
}
