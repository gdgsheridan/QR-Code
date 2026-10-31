
import { Entrance } from '@/components/motion';
import { BrandMark } from '@/components/brand-mark';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { headers } from 'next/headers';
import { z } from 'zod';
import { currentUser } from '@/lib/auth/session';
import { db } from '@/lib/db/server';
import { clientIpKey } from '@/lib/http/ip';
import { IP_CEILING_PER_MIN, withinLimit } from '@/lib/pass/handlers';
import { normalizeUid } from '@/lib/domain/badge';
import { normalizeEmail } from '@/lib/domain/normalize';
import { CopyButton } from './copy-button';

// SPEC §6.5: what a phone opens when it taps a badge. Public since v0.9: no sign-in needed, and
// badge_profile() returns only what the holder shares. The holder's own tap opens their menu.
// Staff link unlinked badges at check-in (v0.10). v0.9.2: Discord and website too.
// `?tap` (on tags written by the earlier datathon-badges app) is ignored.
export const metadata: Metadata = {
  title: 'Badge · Datathon',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

const profileSchema = z
  .union([
    z.object({ allowed: z.literal(true), public: z.literal(false) }),
    z.object({
      allowed: z.literal(true),
      public: z.literal(true),
      firstName: z.string(),
      lastName: z.string(),
      linkedinUrl: z.string().nullable(),
      discord: z.string().nullable(),
      websiteUrl: z.string().nullable(),
    }),
  ])
  .nullable();

// "https://ada.dev/" → "ada.dev", "https://github.com/ada" → "github.com/ada".
const siteLabel = (href: string) => {
  const url = new URL(href);
  return `${url.host}${url.pathname}${url.search}`.replace(/\/$/, '');
};

export default async function BadgeProfilePage(props: { params: Promise<{ uid: string }> }) {
  await connection(); // per request: an opt-out must take effect on the next view
  const raw = (await props.params).uid;
  const uid = normalizeUid(raw);
  if (!uid) notFound();
  // M5: public by design, but short UIDs are enumerable, so throttle per client IP (hashed key
  // only, I-11) before touching the DB. Same venue-NAT ceiling as the pass endpoints: a whole hall
  // can share one egress IP. Over the limit the page answers 200 with a neutral retry note in the
  // usual shell — no profile data and no existence signal either way (a 404 would imply unlinked).
  if (!(await withinLimit(db(), clientIpKey(await headers(), 'profile'), 60, IP_CEILING_PER_MIN))) {
    return (
      <Entrance><main className="max-w-[480px] lg:pointer-fine:max-w-[760px]  m-[0px_auto] p-[24px_16px_56px] flex flex-col gap-[16px] [:where(&)_>_*]:mt-0

          [:where(&)_>_*]:mb-0">
        <BrandMark className="min-h-11 mb-[8px]" />
        <Card className="[&>p]:m-0 [&>h2]:text-lg " asChild><section >
          <h1>Too many requests</h1>
          <p className="copy">Try again shortly.</p>
        </section></Card>
      </main></Entrance>
    );
  }
  const viewer = await currentUser();

  const { data, error } = await db().rpc('badge_profile', {
    p_uid: uid,
    ...(viewer && { p_viewer_id: viewer.id, p_viewer_email: normalizeEmail(viewer.email ?? '') }),
  });
  if (error) throw new Error(`badge_profile failed (${error.code})`);
  // v0.6 (F14): the holder tapping their own badge opens their hacker menu.
  if (z.object({ self: z.literal(true) }).safeParse(data).success) redirect('/me');
  const profile = profileSchema.parse(data);

  return (
    <Entrance><main className="max-w-[480px] lg:pointer-fine:max-w-[760px]  m-[0px_auto] p-[24px_16px_56px] flex flex-col gap-[16px] [:where(&)_>_*]:mt-0

          [:where(&)_>_*]:mb-0">
      <BrandMark className="min-h-11 mb-[8px]" />
      <Card className="[&>p]:m-0 [&>h2]:text-lg " asChild><section >
        {profile === null && (
          <>
            <h1>This badge isn’t linked yet</h1>
            <p className="copy">Staff link badges at the check-in desk.</p>
          </>
        )}
        {profile && !profile.public && (
          <>
            <h1>This attendee hasn’t shared a profile</h1>
            <p className="copy">They can choose to share their name and links from their Datathon account.</p>
          </>
        )}
        {profile?.public && (
          <>
            <h1 className="text-[28px] font-semibold leading-[1.2]">{`${profile.firstName} ${profile.lastName}`.trim()}</h1>
            {profile.linkedinUrl && (
              <Button className="self-start" asChild><a  href={profile.linkedinUrl} rel="noopener noreferrer">
                View LinkedIn profile
              </a></Button>
            )}
            {profile.discord && (
              <div className="flex flex-wrap items-center gap-[4px_12px] min-h-[44px] pt-[12px] [border-top-width:1px]

          [border-top-style:solid] [border-top-color:var(--line)]">
                <span className="text-muted-foreground text-[12px] tracking-[0.08em] uppercase min-w-[72px]">Discord</span>
                <span className="flex-1 min-w-0 [overflow-wrap:anywhere] font-semibold">@{profile.discord}</span>
                <CopyButton text={profile.discord} label="Copy Discord username" />
              </div>
            )}
            {profile.websiteUrl && (
              <div className="flex flex-wrap items-center gap-[4px_12px] min-h-[44px] pt-[12px] [border-top-width:1px]

          [border-top-style:solid] [border-top-color:var(--line)]">
                <span className="text-muted-foreground text-[12px] tracking-[0.08em] uppercase min-w-[72px]">Website</span>
                {/* The holder typed this link: nofollow/ugc, and its address is the label so the tapper sees where it goes. */}
                <a className="flex-1 min-w-0 [overflow-wrap:anywhere] font-semibold" href={profile.websiteUrl} rel="nofollow noopener noreferrer ugc">
                  {siteLabel(profile.websiteUrl)}
                </a>
              </div>
            )}
            {!profile.linkedinUrl && !profile.discord && !profile.websiteUrl && <p>No links shared.</p>}
          </>
        )}
      </section></Card>
    </main></Entrance>
  );
}
