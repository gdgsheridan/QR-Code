
import { SectionLabel } from '@/components/section-label';
import { BrandMark } from '@/components/brand-mark';
import { Entrance } from '@/components/motion';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { Input } from '@/components/ui/input';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth/session';
import { db } from '@/lib/db/server';
import { formatJoinCode } from '@/lib/domain/team';
import { myEvent } from '@/lib/me/profile';
import { createTeam, declineInvite, joinTeam, leaveTeam, myTeam, setLooking, setTeamTrack, type TeamCode } from '@/lib/me/team';
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
    : op === 'looking' ? await setLooking(db(), user, m.participantId, field('looking') === 'on')
    : op === 'create'
      ? await createTeam(db(), user, m.participantId, field('name'))
      : op === 'join'
        ? await joinTeam(db(), user, m.participantId, { code: field('code') })
        : op === 'leave'
          ? await leaveTeam(db(), user, m.participantId)
          : await setTeamTrack(db(), user, m.participantId, field('trackId'));
  redirect(`/me/team?r=${r}`);
}

export default async function TeamPage(props: { searchParams: Promise<{ r?: string }> }) {
  const { r } = await props.searchParams;
  const { me: m, now } = await loadMyEvent('/me/team');
  const { tracks, team, invites } = await myTeam(db(), m);
  const live = Date.parse(m.event.endsAt) > now.getTime();
  const open = m.event.teamsOpen && live;
  const notice = r === 'SAVED' && !team ? '✓ Directory preference saved.' : r && r in NOTICES ? NOTICES[r as TeamCode] : null;
  const trackName = tracks.find((t) => t.id === team?.trackId)?.name;

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
              <Button type="submit" variant="outline">
                Leave team
              </Button>
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
    </main></Entrance>
  );
}
