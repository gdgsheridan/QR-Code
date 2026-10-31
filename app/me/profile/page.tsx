
import { SectionLabel } from '@/components/section-label';
import { BrandMark } from '@/components/brand-mark';
import { Entrance } from '@/components/motion';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth/session';
import { db } from '@/lib/db/server';
import { DISCORD_PATTERN, LINKEDIN_PATTERN, WEBSITE_PATTERN } from '@/lib/domain/badge';
import { PACE, type ProfileInput } from '@/lib/domain/profile';
import { saveBadgeProfile, type SaveProfileResult } from '@/lib/me/profile';
import { loadMyEvent, menuMetadata } from '../load';
import { AllergyFields } from './allergy-fields';
import { SetupWalkthrough, SetupForm, SetupStep, SetupPanel } from './setup-walkthrough';

// Native form posts need a same-origin Origin header before hydration.
export const metadata: Metadata = { ...menuMetadata('Hacker profile'), referrer: 'same-origin' };

const ERRORS: Partial<Record<SaveProfileResult, string>> = {
  INVALID_BIO: '✕ Not saved. Keep your bio to 280 characters or less.',
  INVALID_PACE: '✕ Not saved. Choose one of the listed paces.',
  INVALID_LINKEDIN: '✕ Not saved. Use your LinkedIn profile link, like linkedin.com/in/yourname.',
  INVALID_DISCORD: '✕ Not saved. Use your Discord username: 2–32 lowercase letters, numbers, _ or . (no # tag).',
  INVALID_WEBSITE: '✕ Not saved. Use a website address under 200 characters, like yourname.dev.',
  INVALID_OVERNIGHT: '✕ Not saved. Tell us whether you’re staying overnight.',
  INVALID_ALLERGY: '✕ Not saved. Pick how severe your allergy is (or clear the allergy field), in 300 characters or less.',
  INVALID_TEAM_STATUS: '✕ Not saved. Tell us about your team.',
  INVALID_ACCESSIBILITY: '✕ Not saved. Keep accessibility needs under 500 characters.',
  NOT_FOUND: '✕ Not saved. Reload the page and try again.',
};

const OVERNIGHT = [
  ['yes', 'Yes'],
  ['no', 'No'],
  ['unsure', 'Not sure yet'],
] as const;
const TEAM = [
  ['team', 'I have a team'],
  ['looking', 'I’m looking for a team (lists my name in the Hacker directory)'],
  ['solo', 'I plan to go solo'],
] as const;

const text = (formData: FormData, key: string) => String(formData.get(key) ?? '');

const TABS = [
  ['networking', 'Networking'],
  ['event', 'The event'],
  ['health', 'Health and access'],
] as const;
type ProfileTab = (typeof TABS)[number][0];
const ERROR_TAB: Partial<Record<SaveProfileResult, ProfileTab>> = {
  INVALID_OVERNIGHT: 'event',
  INVALID_TEAM_STATUS: 'event',
  INVALID_ALLERGY: 'health',
  INVALID_ACCESSIBILITY: 'health',
  INVALID_LINKEDIN: 'networking',
  INVALID_DISCORD: 'networking',
  INVALID_WEBSITE: 'networking',
  INVALID_BIO: 'networking',
  INVALID_PACE: 'networking',
};

async function saveSection(tab: Exclude<ProfileTab, 'networking'>, formData: FormData) {
  'use server';
  const user = await currentUser();
  if (!user) redirect('/login?next=/me/profile');
  const fields = {
    event: ['overnight', 'teamStatus'],
    health: ['allergies', 'allergySeverity', 'accessibility'],
  } as const;
  const input: ProfileInput = {};
  for (const field of fields[tab]) input[field] = text(formData, field);
  const result = await saveBadgeProfile(db(), user, text(formData, 'participantId'), input);
  redirect(`/me/profile?tab=${ERROR_TAB[result] ?? tab}&${result === 'SAVED' ? 'saved=1' : `error=${result}`}`);
}

// SPEC F14 (v0.9): profile setup after the RSVP Yes. Overnight and team status are required; allergies (with how
// severe) and accessibility are optional. The emergency contact is required too, but has its own page (/me/emergency). Only the organizers see the private answers, and
// meal volunteers see the allergies.
async function saveSetup(formData: FormData) {
  'use server';
  const user = await currentUser();
  if (!user) redirect('/login?next=/me/profile');
  const result = await saveBadgeProfile(
    db(),
    user,
    text(formData, 'participantId'),
    {
      overnight: text(formData, 'overnight'),
      allergies: text(formData, 'allergies'),
      allergySeverity: text(formData, 'allergySeverity'),
      teamStatus: text(formData, 'teamStatus'),
      accessibility: text(formData, 'accessibility'),
    },
    { setup: true },
  );
  redirect(`/me/profile?${result === 'SAVED' ? `saved=setup${formData.get('walkthrough') === '1' ? '&step=links' : ''}` : `error=${result}${formData.get('walkthrough') === '1' ? '&setup=1' : ''}`}`);
}

// SPEC F14 / §6.5: the attendee's own LinkedIn, Discord username and website (v0.9.2), and badge sharing. Dietary notes come from the Sheet and only
// organizers see them (v0.8.2): no key here, so the stored notes stay as they are.
async function saveNetworking(formData: FormData) {
  'use server';
  const user = await currentUser();
  if (!user) redirect('/login?next=/me/profile');
  const result = await saveBadgeProfile(db(), user, text(formData, 'participantId'), {
    linkedin: text(formData, 'linkedin'),
    discord: text(formData, 'discord'),
    website: text(formData, 'website'),
    profilePublic: formData.get('public') === 'on',
    directoryOptIn: formData.get('directoryOptIn') === 'on',
    bio: text(formData, 'bio'),
    pace: text(formData, 'pace'),
  });
  if (formData.get('walkthrough') !== '1') {
    redirect(`/me/profile?tab=networking&${result === 'SAVED' ? 'saved=1' : `error=${result}`}`);
  }
  redirect(`/me/profile?${result === 'SAVED' ? `saved=1${formData.get('walkthrough') === '1' ? '&step=links' : ''}` : `error=${result}${formData.get('walkthrough') === '1' ? '&step=links' : ''}`}`);
}

export default async function HackerProfilePage(props: {
  searchParams: Promise<{ saved?: string; error?: string; setup?: string; step?: string; tab?: string }>;
}) {
  const notices = await props.searchParams;
  const { me: m } = await loadMyEvent('/me/profile');
  const error = ERRORS[notices.error as SaveProfileResult];
  const networkingError = ['INVALID_LINKEDIN', 'INVALID_DISCORD', 'INVALID_WEBSITE', 'INVALID_BIO', 'INVALID_PACE'].includes(notices.error ?? '');

  // The walkthrough is the RSVP's onboarding ("Set up my hacker profile" → ?setup=1); from the menu each section has its own tab and save.
  const walkthrough = notices.setup === '1' || notices.step === 'links';
  // The emergency contact lives on /me/emergency; this page only links to it while it is missing.
  const setupDone = m.overnight !== null && m.teamStatus !== null;
  // Unanswered setup questions come first; otherwise the first tab.
  const defaultTab = setupDone ? 'networking' : 'event';
  const tab = ERROR_TAB[notices.error as SaveProfileResult]
    ?? TABS.find(([value]) => value === notices.tab)?.[0] ?? defaultTab;
  const unfinished = { event: !setupDone, health: false, networking: false };
  const initialStep = networkingError || (notices.step === 'links' && setupDone) ? 3
    : ['INVALID_OVERNIGHT', 'INVALID_TEAM_STATUS'].includes(notices.error ?? '') ? 1
    : error ? 2 : 1;

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
      <h1>{setupDone ? 'Hacker profile' : 'Finish setting up your profile'}</h1>
      {!setupDone && <p className="copy m-0 text-muted-foreground text-[14px]">A few things we need before {m.event.name}. Your health and access answers stay with organizers; volunteers serving food see your allergy. Networking sharing is your choice.</p>}
      {!m.emergency && <Alert role="note" asChild><p>
        We still need your emergency contact. <Link className="font-semibold text-accent" href="/me/emergency">Add your emergency contact →</Link>
      </p></Alert>}

      {!walkthrough && <nav aria-label="Profile sections" className="flex min-w-0 max-w-full gap-1 overflow-x-auto overflow-y-hidden">
        {TABS.map(([value, label]) => <a key={value} href={`/me/profile?tab=${value}`} aria-current={tab === value ? 'page' : undefined}
          className="inline-flex min-h-12 shrink-0 items-center whitespace-nowrap rounded-t-lg border-b-2 border-transparent px-3 text-sm font-semibold text-muted-foreground no-underline hover:bg-accent/6 hover:text-fg focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-3 aria-[current=page]:border-accent aria-[current=page]:bg-accent/8 aria-[current=page]:text-accent aria-[current=page]:font-bold">
          {label}{unfinished[value] && <span className="ml-1 font-normal">· needs answer</span>}
        </a>)}
      </nav>}
      {!walkthrough && notices.saved === '1' && tab !== 'networking' && <Alert className="text-ok" role="status">✓ Saved.</Alert>}
          {notices.saved === 'setup' && (
            <Alert className="text-ok" asChild role="status"><p role="status" >
              ✓ Saved. Your profile is set up.
            </p></Alert>
          )}
      <SetupWalkthrough key={`${notices.error ?? ''}:${notices.saved ?? ''}:${notices.step ?? ''}`} enabled={walkthrough} initialStep={initialStep}>
      {(walkthrough || tab !== 'networking') && <SetupPanel>
      <Card className="[&>p]:m-0 [&>h2]:text-lg " asChild><section aria-label="Profile setup" >
        <SetupForm action={walkthrough ? saveSetup : saveSection.bind(null, tab === 'networking' ? 'event' : tab)} className="grid gap-[16px] [&_label_+_:is(input,_select,_textarea)]:mt-[-10px] [&_label]:text-[14px]

          [&_label]:font-medium [&_h2]:m-[12px_0px_-8px] [&_h2]:pt-[16px] [&_h2]:[border-top-width:1px]

          [&_h2]:[border-top-style:solid] [&_h2]:[border-top-color:var(--line)] [&_h2]:text-[18px]

          [&_h2:first-of-type]:mt-0 [&_h2:first-of-type]:pt-0 [&_h2:first-of-type]:[border-top:0px]">
          <input type="hidden" name="participantId" value={m.participantId} />
          <input type="hidden" name="walkthrough" value={walkthrough ? '1' : '0'} />
          {(walkthrough || tab === 'event') && <SetupStep number={1}>
          <h2 id="setup-step-1" tabIndex={-1}>The event</h2>
          <fieldset className="grid gap-[2px] m-0 p-0 [border-width:0px] [border-style:none] [border-color:currentcolor] min-w-0

          [&_legend]:p-0 [&_legend]:mb-[4px] [&_legend]:text-[14px] [&_legend]:font-medium">
            <legend>Staying overnight?</legend>
            {OVERNIGHT.map(([value, label]) => (
              <Label key={value} className="flex gap-[10px] items-center min-h-[44px] [&_input]:[flex:0_0_auto] [&_input]:w-[22px]

          [&_input]:h-[22px]">
                <input type="radio" name="overnight" value={value} required defaultChecked={m.overnight === value} />
                {label}
              </Label>
            ))}
          </fieldset>
          <fieldset className="grid gap-[2px] m-0 p-0 [border-width:0px] [border-style:none] [border-color:currentcolor] min-w-0

          [&_legend]:p-0 [&_legend]:mb-[4px] [&_legend]:text-[14px] [&_legend]:font-medium">
            <legend>Your team</legend>
            {TEAM.map(([value, label]) => (
              <Label key={value} className="flex gap-[10px] items-center min-h-[44px] [&_input]:[flex:0_0_auto] [&_input]:w-[22px]

          [&_input]:h-[22px]">
                <input type="radio" name="teamStatus" value={value} required defaultChecked={m.teamStatus === value} />
                {label}
              </Label>
            ))}
          </fieldset>

          {!walkthrough && <Button type="submit">Save profile</Button>}
          </SetupStep>}
          {(walkthrough || tab === 'health') && <SetupStep number={2}>
          <h2 id="setup-step-2" tabIndex={-1}>Health and access</h2>
          <AllergyFields allergies={m.allergies ?? ''} severity={m.allergySeverity ?? ''} inputClass={`min-h-[48px] p-[0px_12px] [font:inherit] [background:var(--raised)] text-fg [border-width:1px]
                [border-style:solid] [border-top-color:var(--field)] [border-right-color:var(--field)]
                [border-bottom-color:var(--field)] [border-left-color:var(--field)] rounded-control
                [&:is(select)]:min-w-0 [&:is(select)]:w-full`} hintClass={" m-0 text-muted-foreground text-[14px]"} />
          <Label htmlFor="accessibility">Accessibility needs (optional)</Label>
          <Textarea id="accessibility" name="accessibility" maxLength={500} placeholder="Anything that would make the event easier for you" defaultValue={m.accessibility ?? ''} className="min-h-12 w-full" />

          <Button type="submit">Save profile</Button>
          </SetupStep>}
          {error && !networkingError && (
            <Alert className="text-bad" asChild><p role="alert" >
              {error}
            </p></Alert>
          )}


        </SetupForm>
      </section></Card>

      </SetupPanel>}
      {(walkthrough || tab === 'networking') && <SetupPanel networking>
      <Card className="[&>p]:m-0 [&>h2]:text-lg " asChild><section aria-labelledby="networking" >
        <h2 id="networking" tabIndex={-1}>Networking</h2>
        <div className="grid gap-[4px]">
          <SectionLabel className="mb-0">Name</SectionLabel>
          <p className="text-[28px] font-semibold leading-[1.2]">{`${m.firstName} ${m.lastName}`.trim()}</p>
        </div>
        {m.badge ? <p className="inline-flex items-center gap-[6px] [align-self:flex-start] p-[4px_10px] rounded-sm

          [background:color-mix(in_srgb,_var(--accent)_12%,_var(--card))] text-ok text-[14px]

          [&[data-tone='muted']]:[background:var(--raised)] [&[data-tone='muted']]:text-muted-foreground">✓ Badge linked.</p> : <p className="copy m-0 text-muted-foreground text-[14px]">No badge yet. Staff link badges at the check-in desk.</p>}
        <form action={saveNetworking} className="grid gap-[16px] [&_label_+_:is(input,_select,_textarea)]:mt-[-10px] [&_label]:text-[14px]

          [&_label]:font-medium [&_h2]:m-[12px_0px_-8px] [&_h2]:pt-[16px] [&_h2]:[border-top-width:1px]

          [&_h2]:[border-top-style:solid] [&_h2]:[border-top-color:var(--line)] [&_h2]:text-[18px]

          [&_h2:first-of-type]:mt-0 [&_h2:first-of-type]:pt-0 [&_h2:first-of-type]:[border-top:0px]">
          <input type="hidden" name="participantId" value={m.participantId} />
          <input type="hidden" name="walkthrough" value={walkthrough ? '1' : '0'} />
          <Label htmlFor="linkedin">LinkedIn (optional)</Label>
          <Input
            id="linkedin"
            name="linkedin"
            inputMode="url"
            maxLength={200}
            pattern={LINKEDIN_PATTERN}
            title="Your LinkedIn profile link, like linkedin.com/in/yourname"
            autoComplete="url"
            placeholder="linkedin.com/in/yourname"
            defaultValue={m.linkedinUrl ?? ''}
            className="min-h-12 w-full"
          />
          <Label htmlFor="discord">Discord username (optional)</Label>
          <Input
            id="discord"
            name="discord"
            maxLength={33}
            pattern={DISCORD_PATTERN}
            title="Your Discord username: 2–32 letters, numbers, _ or ."
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
            placeholder="yourname"
            defaultValue={m.discordUsername ?? ''}
            className="min-h-12 w-full"
          />
          <Label htmlFor="website">Website (optional)</Label>
          <Input
            id="website"
            name="website"
            inputMode="url"
            maxLength={200}
            pattern={WEBSITE_PATTERN}
            title="A website address, like yourname.dev"
            autoComplete="url"
            placeholder="yourname.dev"
            defaultValue={m.websiteUrl ?? ''}
            className="min-h-12 w-full"
          />
          <Label htmlFor="bio">Bio (optional)</Label>
          <Textarea id="bio" name="bio" maxLength={280} rows={4} defaultValue={m.bio ?? ''} placeholder="What do you enjoy building? Who would you like to meet?" className="min-h-24 w-full" />
          <Label htmlFor="profilePace">Your pace (optional)</Label>
          <NativeSelect id="profilePace" name="pace" defaultValue={m.pace ?? ''} className="min-h-12 w-full">
            <option value="">No pace set</option>
            {Object.entries(PACE).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </NativeSelect>
          <Label className="flex min-h-11 items-center gap-3">
            <input type="checkbox" name="directoryOptIn" defaultChecked={m.directoryOptIn} className="size-[22px] shrink-0" />
            List me in the Hacker directory
          </Label>
          <Label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}>
            <input type="checkbox" name="public" defaultChecked={m.profilePublic} style={{ width: 22, height: 22 }} />
            Show my name and these links to anyone who taps my badge
          </Label>
          {error && (!walkthrough || networkingError || notices.step === 'links') && (
            <Alert className="text-bad" asChild><p role="alert" >
              {error}
            </p></Alert>
          )}
          {notices.saved === '1' && (
            <Alert className="text-ok" asChild role="status"><p role="status" >
              ✓ Saved.
            </p></Alert>
          )}
          <Button type="submit">Save links</Button>
        </form>
      </section></Card>
      </SetupPanel>}
      </SetupWalkthrough>
    </main></Entrance>
  );
}
