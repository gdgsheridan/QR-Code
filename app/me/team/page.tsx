
import { SectionLabel } from '@/components/section-label';
import { BrandMark } from '@/components/brand-mark';
import { Entrance } from '@/components/motion';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { ConfirmSubmit } from '@/components/confirm-submit';
import { NativeSelect } from '@/components/ui/native-select';
import { Input } from '@/components/ui/input';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth/session';
import { db } from '@/lib/db/server';
import { formatJoinCode } from '@/lib/domain/team';
import { myEvent, type MyEvent } from '@/lib/me/profile';
import { createTeam, declineInvite, joinTeam, leaveTeam, myTeam, tracksWithTeams, setLooking, setTeamTrack, setTrackInterests, type TeamCode } from '@/lib/me/team';
import { loadMyEvent, menuMetadata } from '../load';

export const metadata: Metadata = menuMetadata('Team');

const initials = (name: string) => name.split(/\s+/).map((w) => Array.from(w)[0] ?? '').join('').slice(0, 2).toUpperCase();

const NOTICES: Record<TeamCode, string> = {
  CREATED: '✓ Team created. Share the code with your teammates.',
  JOINED: '✓ You joined the team.',
  LEFT: '✓ You left the team.',
  SAVED: '✓ Track saved.',
  INVITED: '✓ Invite sent. They can accept on their Team page.',
  ALREADY_INVITED: '✕ You’ve already invited them.',
  NOT_LOOKING: '✕ They’re no longer looking for a team.',
  SELF: '✕ You can’t invite yourself.',
  DECLINED: '✓ Invite declined.',
  IN_A_TEAM: '✕ You’re already in a team. Leave it first.',
  NAME_TAKEN: '✕ Another team already has that name.',
  BAD_CODE: '✕ No team has that code. Check it and try again.',
  TEAM_FULL: '✕ That team already has 4 people.',
  CLOSED: '✕ Teams are closed right now. Ask an organizer.',
  NOT_RELEASED: '✕ Tracks aren’t released yet.',
  BAD_TRACK: '✕ That track isn’t part of this event any more. Reload and pick again.',
  NOT_FOUND: '✕ Something changed. Reload the page and try again.',
  INVALID_NAME: '✕ Give your team a name, up to 60 characters.',
};

// SPEC F15 (v0.7): create, join, leave and pick a track. The participant comes from the session, never the form.
async function act(formData: FormData) {
  'use server';
  const user = await currentUser();
  if (!user) redirect('/login?next=/me/team');
  const m = await myEvent(db(), user.email ?? '', new Date());
  if (!m) redirect('/me/team?r=NOT_FOUND');
  const field = (k: string) => String(formData.get(k) ?? '');
  const op = field('op');
  const r =
    op === 'accept' ? await joinTeam(db(), user, m.participantId, { teamId: field('teamId') })
    : op === 'decline' ? await declineInvite(db(), user, m.participantId, field('teamId'))
    : op === 'looking' ? await saveLooking(user, m.participantId, field('looking') === 'on', formData.getAll('track').map(String))
    : op === 'create'
      ? await createTeam(db(), user, m.participantId, field('name'))
      : op === 'join'
        ? await joinTeam(db(), user, m.participantId, { code: field('code') })
        : op === 'leave'
          ? await leaveTeam(db(), user, m.participantId)
          : await setTeamTrack(db(), user, m.participantId, field('trackId'));
  redirect(`/me/team?r=${r}`);
}

// v0.11.25: Looking and the tracks they want to do save together.
async function saveLooking(user: { id: string; email: string | null }, participantId: string, on: boolean, tracks: string[]) {
  const looking = await setLooking(db(), user, participantId, on);
  return looking === 'SAVED' ? setTrackInterests(db(), user, participantId, tracks) : looking;
}

export default async function TeamPage(props: { searchParams: Promise<{ r?: string; tab?: string | string[] }> }) {
  const { r, tab: requestedTab } = await props.searchParams;
  const tab = requestedTab === 'tracks' ? 'tracks' : 'team';
  const { me: m, now } = await loadMyEvent('/me/team');
  return (
    <Entrance><main className="max-w-[480px] lg:pointer-fine:max-w-[760px]  m-[0px_auto] p-[24px_16px_56px] flex flex-col gap-[16px] [:where(&)_>_*]:mt-0

          [:where(&)_>_*]:mb-0">
      <div className="flex items-center gap-[16px] min-h-[44px] mb-[8px]">
        <Link className="inline-flex shrink-0 items-center min-h-[44px] text-fg font-semibold no-underline [&:hover]:text-accent" href="/me">
          ← Menu
        </Link>
        <BrandMark name={m.event.name} className="max-w-[70%]" />
        <span aria-hidden="true" className="min-w-3 flex-1 h-px bg-[var(--edge)]" />
      </div>
      <h1>Team</h1>
      <nav aria-label="Team sections" className="flex min-w-0 max-w-full gap-1 overflow-x-auto overflow-y-hidden">
        {([['team', 'My team'], ['tracks', 'Tracks']] as const).map(([value, label]) => (
          <a key={value} href={value === 'tracks' ? '/me/team?tab=tracks' : '/me/team'} aria-current={tab === value ? 'page' : undefined}
            className="inline-flex min-h-12 shrink-0 items-center whitespace-nowrap rounded-t-lg border-b-2 border-transparent px-3 text-sm font-semibold text-muted-foreground no-underline hover:bg-accent/6 hover:text-fg focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-3 aria-[current=page]:border-accent aria-[current=page]:bg-accent/8 aria-[current=page]:text-accent aria-[current=page]:font-bold">
            {label}
          </a>
        ))}
      </nav>
      {tab === 'tracks' ? <TracksContent me={m} /> : <MyTeamContent me={m} now={now} r={r} />}
    </main></Entrance>
  );
}

async function TracksContent({ me }: { me: MyEvent }) {
  const tracks = await tracksWithTeams(db(), me);
  if (tracks === null) return <p className="copy">Tracks are announced at the hackathon.</p>;
  if (tracks.length === 0) return <p className="copy">No tracks yet.</p>;
  return tracks.map((track, index) => (
    <Card key={track.id ?? 'unassigned'} className="[&>p]:m-0 [&>h2]:text-lg" asChild>
      <section aria-labelledby={`track-${index}`}>
        <h2 id={`track-${index}`}>{track.name}</h2>
        <p>{track.teams.length} {track.teams.length === 1 ? 'team' : 'teams'}</p>
        {track.teams.length === 0 ? <p>No teams yet</p> : (
          <ul className="m-0 p-0 list-none grid gap-2 break-words">
            {track.teams.map((team) => (
              <li key={team.id}>
                {team.name} · {team.memberCount} {team.memberCount === 1 ? 'member' : 'members'}
                {team.id === me.teamId && <strong> (your team)</strong>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </Card>
  ));
}

async function MyTeamContent({ me: m, now, r }: { me: MyEvent; now: Date; r?: string }) {
  const { tracks, team, invites, myTrackIds } = await myTeam(db(), m);
  const live = Date.parse(m.event.endsAt) > now.getTime();
  const open = m.event.teamsOpen && live;
  const notice = r === 'SAVED' && !team ? '✓ Directory preference saved.' : r && r in NOTICES ? NOTICES[r as TeamCode] : null;
  const trackName = tracks.find((t) => t.id === team?.trackId)?.name;

  return (
    <>
      {notice && (
        <p role={notice.startsWith('✓') ? 'status' : 'alert'} className={notice.startsWith('✓') ? " text-ok" : " text-bad"}>
          {notice}
        </p>
      )}
      {!team && live && (
        <Card className="[&>p]:m-0 [&>h2]:text-lg " asChild><section aria-labelledby="looking-title" >
          <h2 id="looking-title">Find teammates</h2>
          <form action={act} className="grid gap-[16px] [&_label_+_:is(input,_select,_textarea)]:mt-[-10px] [&_label]:text-[14px]

          [&_label]:font-medium [&_h2]:m-[12px_0px_-8px] [&_h2]:pt-[16px] [&_h2]:[border-top-width:1px]

          [&_h2]:[border-top-style:solid] [&_h2]:[border-top-color:var(--line)] [&_h2]:text-[18px]

          [&_h2:first-of-type]:mt-0 [&_h2:first-of-type]:pt-0 [&_h2:first-of-type]:[border-top:0px]">
            <input type="hidden" name="op" value="looking" />
            <Label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}>
              <input type="checkbox" name="looking" defaultChecked={m.lookingForTeam} style={{ width: 22, height: 22 }} />
              Looking for a team
            </Label>
            {tracks.length > 0 && <fieldset className="grid gap-[2px] m-0 p-0 border-0 min-w-0 [&_legend]:p-0 [&_legend]:mb-[4px] [&_legend]:text-[14px] [&_legend]:font-medium">
              <legend>Tracks I want to do</legend>
              {tracks.map((t) => (
                <Label key={t.id} className="flex min-h-11 items-center gap-3 font-normal">
                  <input type="checkbox" name="track" value={t.id} defaultChecked={myTrackIds.includes(t.id)} className="size-[22px] shrink-0" />
                  {t.name}
                </Label>
              ))}
            </fieldset>}
            <Button type="submit">Save directory preference</Button>
          </form>
        </section></Card>
      )}
      {!team && invites.length > 0 && (
        <Card className="[&>p]:m-0 [&>h2]:text-lg " asChild><section aria-labelledby="invites-title" >
          <h2 id="invites-title">Pending invites</h2>
          <ul className="m-0 p-0 list-none [&_li]:flex [&_li]:flex-wrap [&_li]:items-center [&_li]:justify-between

          [&_li]:gap-[8px_12px] [&_li]:min-h-[56px] [&_li]:p-[6px_0px] [&_p]:m-0

          [&_li_+_li]:[border-top-width:1px] [&_li_+_li]:[border-top-style:solid]

          [&_li_+_li]:[border-top-color:var(--line)]">
            {invites.map((invite) => (
              <li key={invite.teamId}>
                <p>
                  {invite.from} invited you to join {invite.teamName}.
                </p>
                <div className="flex flex-wrap gap-[8px]">
                  {open && (
                    <form action={act}>
                      <input type="hidden" name="op" value="accept" />
                      <input type="hidden" name="teamId" value={invite.teamId} />
                      <Button type="submit">Accept</Button>
                    </form>
                  )}
                  <form action={act}>
                    <input type="hidden" name="op" value="decline" />
                    <input type="hidden" name="teamId" value={invite.teamId} />
                    <Button type="submit" variant="outline">
                      Decline
                    </Button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </section></Card>
      )}
      {team ? (
        <Card className="[&>p]:m-0 [&>h2]:text-lg " asChild><section aria-labelledby="team-name" >
          <h2 id="team-name">{team.name}</h2>
          <ul className="m-0 p-0 list-none grid gap-[8px] [&_li]:flex [&_li]:items-center [&_li]:gap-[12px]">
            {team.members.map((name) => (
              <li key={name}>
                <span className="grid [place-items:center] [flex:0_0_auto] w-[32px] h-[32px] rounded-[50%] [background:var(--raised)]

          [border-width:1px] [border-style:solid] [border-top-color:var(--line)] [border-right-color:var(--line)]

          [border-bottom-color:var(--line)] [border-left-color:var(--line)] text-link text-[12px] font-semibold" aria-hidden="true">
                  {initials(name)}
                </span>
                {name}
              </li>
            ))}
          </ul>
          <div className="grid gap-[4px] p-[12px_16px] [border-width:1px] [border-style:dashed]

          [border-top-color:color-mix(in_srgb,_var(--accent)_55%,_transparent)]

          [border-right-color:color-mix(in_srgb,_var(--accent)_55%,_transparent)]

          [border-bottom-color:color-mix(in_srgb,_var(--accent)_55%,_transparent)]

          [border-left-color:color-mix(in_srgb,_var(--accent)_55%,_transparent)] rounded-md

          [background:var(--raised)]">
            <SectionLabel className="mb-0">Join code</SectionLabel>
            <strong className="text-accent text-[26px] font-semibold tracking-[0.12em]">{formatJoinCode(team.code)}</strong>
            <span className="m-0 text-muted-foreground text-[14px]">Share it with your teammates (4 people at most).</span>
          </div>
          <div className="pt-[16px] [border-top-width:1px] [border-top-style:solid] [border-top-color:var(--line)]">
            <h3>Track</h3>
            {!m.event.tracksReleased ? (
              <p className="copy">Tracks are announced at the hackathon.</p>
            ) : live && tracks.length > 0 ? (
              <form action={act} className="grid gap-[16px] [&_label_+_:is(input,_select,_textarea)]:mt-[-10px] [&_label]:text-[14px]

          [&_label]:font-medium [&_h2]:m-[12px_0px_-8px] [&_h2]:pt-[16px] [&_h2]:[border-top-width:1px]

          [&_h2]:[border-top-style:solid] [&_h2]:[border-top-color:var(--line)] [&_h2]:text-[18px]

          [&_h2:first-of-type]:mt-0 [&_h2:first-of-type]:pt-0 [&_h2:first-of-type]:[border-top:0px]">
                <input type="hidden" name="op" value="track" />
                <Label htmlFor="trackId">Your team’s track</Label>
                <NativeSelect id="trackId" name="trackId" defaultValue={team.trackId ?? ''} required className="min-h-12 w-full">
                  <option value="" disabled>
                    Pick a track
                  </option>
                  {tracks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </NativeSelect>
                <Button type="submit">Save track</Button>
              </form>
            ) : (
              <p>{trackName ?? 'No track chosen.'}</p>
            )}
          </div>
          {open && (
            <form action={act} className="grid gap-[16px] [&_label_+_:is(input,_select,_textarea)]:mt-[-10px] [&_label]:text-[14px]

          [&_label]:font-medium [&_h2]:m-[12px_0px_-8px] [&_h2]:pt-[16px] [&_h2]:[border-top-width:1px]

          [&_h2]:[border-top-style:solid] [&_h2]:[border-top-color:var(--line)] [&_h2]:text-[18px]

          [&_h2:first-of-type]:mt-0 [&_h2:first-of-type]:pt-0 [&_h2:first-of-type]:[border-top:0px] pt-[16px]

          [border-top-width:1px] [border-top-style:solid] [border-top-color:var(--line)]">
              <input type="hidden" name="op" value="leave" />
              <ConfirmSubmit title={`Leave ${team.name}?`} cancelLabel="Keep my team" confirmLabel="Leave team"
                message={team.members.length === 1 ? 'You’re its only member, so leaving deletes the team.' : 'You can rejoin with its code while team forming is open and there’s room.'}>
                Leave team
              </ConfirmSubmit>
            </form>
          )}
        </section></Card>
      ) : !open ? (
        <Card className="[&>p]:m-0 [&>h2]:text-lg " asChild><section >
          <p>{live ? 'Teams open on hackathon day. Come back then to create or join one.' : 'The event is over.'}</p>
        </section></Card>
      ) : (
        <>
          <Card className="[&>p]:m-0 [&>h2]:text-lg " asChild><section aria-labelledby="create" >
            <h2 id="create">Create a team</h2>
            <form action={act} className="grid gap-[16px] [&_label_+_:is(input,_select,_textarea)]:mt-[-10px] [&_label]:text-[14px]

          [&_label]:font-medium [&_h2]:m-[12px_0px_-8px] [&_h2]:pt-[16px] [&_h2]:[border-top-width:1px]

          [&_h2]:[border-top-style:solid] [&_h2]:[border-top-color:var(--line)] [&_h2]:text-[18px]

          [&_h2:first-of-type]:mt-0 [&_h2:first-of-type]:pt-0 [&_h2:first-of-type]:[border-top:0px]">
              <input type="hidden" name="op" value="create" />
              <Label htmlFor="name">Team name</Label>
              <Input id="name" name="name" required maxLength={60} autoComplete="off" className="min-h-12 w-full" />
              <Button type="submit">Create team</Button>
            </form>
          </section></Card>
          <Card className="[&>p]:m-0 [&>h2]:text-lg " asChild><section aria-labelledby="join" >
            <h2 id="join">Join with a code</h2>
            <form action={act} className="grid gap-[16px] [&_label_+_:is(input,_select,_textarea)]:mt-[-10px] [&_label]:text-[14px]

          [&_label]:font-medium [&_h2]:m-[12px_0px_-8px] [&_h2]:pt-[16px] [&_h2]:[border-top-width:1px]

          [&_h2]:[border-top-style:solid] [&_h2]:[border-top-color:var(--line)] [&_h2]:text-[18px]

          [&_h2:first-of-type]:mt-0 [&_h2:first-of-type]:pt-0 [&_h2:first-of-type]:[border-top:0px]">
              <input type="hidden" name="op" value="join" />
              <Label htmlFor="code">Join code</Label>
              <Input id="code" name="code" required maxLength={20} autoComplete="off" autoCapitalize="characters" placeholder="ABCD-EFGH" className="min-h-12 w-full" />
              <Button type="submit">Join team</Button>
            </form>
          </section></Card>
        </>
      )}
      <Link href="/me/hackers?looking=1" className="inline-flex min-h-11 items-center">Find teammates in the Hacker directory →</Link>
    </>
  );
}
