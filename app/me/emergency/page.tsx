
import { BrandMark } from '@/components/brand-mark';
import { Entrance } from '@/components/motion';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth/session';
import { db } from '@/lib/db/server';
import { PHONE_PATTERN } from '@/lib/domain/profile';
import { saveBadgeProfile } from '@/lib/me/profile';
import { loadMyEvent, menuMetadata } from '../load';

export const metadata: Metadata = menuMetadata('Emergency contact');


// SPEC F14: the event's emergency info (organizers write it on the Info page) and the attendee's own
// emergency contact, which only organizers see.
async function save(formData: FormData) {
  'use server';
  const user = await currentUser();
  if (!user) redirect('/login?next=/me/emergency');
  const result = await saveBadgeProfile(db(), user, String(formData.get('participantId') ?? ''), {
    emergencyName: String(formData.get('emergencyName') ?? ''),
    emergencyPhone: String(formData.get('emergencyPhone') ?? ''),
    emergencyRelation: String(formData.get('emergencyRelation') ?? ''),
  });
  redirect(`/me/emergency?${result === 'SAVED' ? 'saved=1' : `error=${result}`}`);
}

export default async function EmergencyPage(props: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const notices = await props.searchParams;
  const { me: m } = await loadMyEvent('/me/emergency');

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
      <h1>Emergency contact</h1>
      <Card className="[&>p]:m-0 [&>h2]:text-lg " asChild><section aria-labelledby="event-help" >
        <h2 id="event-help">During the event</h2>
        <p className="copy whitespace-pre-line [overflow-wrap:anywhere] leading-[1.7]">{m.event.emergencyInfo || 'The organizers haven’t posted emergency info yet. Find an organizer at the venue.'}</p>
      </section></Card>
      <Card className="[&>p]:m-0 [&>h2]:text-lg " asChild><section aria-labelledby="own-contact" >
        <h2 id="own-contact">Your emergency contact</h2>
        <form action={save} className="grid gap-[16px] [&_label_+_:is(input,_select,_textarea)]:mt-[-10px] [&_label]:text-[14px]

          [&_label]:font-medium [&_h2]:m-[12px_0px_-8px] [&_h2]:pt-[16px] [&_h2]:[border-top-width:1px]

          [&_h2]:[border-top-style:solid] [&_h2]:[border-top-color:var(--line)] [&_h2]:text-[18px]

          [&_h2:first-of-type]:mt-0 [&_h2:first-of-type]:pt-0 [&_h2:first-of-type]:[border-top:0px]">
          <input type="hidden" name="participantId" value={m.participantId} />
          <Label htmlFor="emergencyName">Name</Label>
          <Input id="emergencyName" name="emergencyName" required maxLength={100} autoComplete="off" defaultValue={m.emergency?.name ?? ''} className="min-h-12 w-full" />
          <Label htmlFor="emergencyPhone">Phone</Label>
          {/* The pattern catches a typo before submitting, so it doesn't clear the form (the server checks again). */}
          <Input
            id="emergencyPhone"
            name="emergencyPhone"
            type="tel"
            required
            maxLength={30}
            pattern={PHONE_PATTERN}
            title="A phone number: digits, spaces and + ( ) - ."
            autoComplete="off"
            defaultValue={m.emergency?.phone ?? ''}
            className="min-h-12 w-full"
          />
          <Label htmlFor="emergencyRelation">Relationship (optional)</Label>
          <Input
            id="emergencyRelation"
            name="emergencyRelation"
            maxLength={60}
            placeholder="Parent, partner, friend…"
            autoComplete="off"
            defaultValue={m.emergency?.relation ?? ''}
            className="min-h-12 w-full"
          />
          {notices.error && (
            <Alert className="text-bad" asChild><p role="alert" >
              {notices.error === 'INVALID_CONTACT' ? '✕ Not saved. Enter a name and a phone number with at least 3 digits.' : '✕ Not saved. Reload the page and try again.'}
            </p></Alert>
          )}
          {notices.saved && (
            <Alert className="text-ok" asChild role="status"><p role="status" >
              ✓ Saved.
            </p></Alert>
          )}
          <Button type="submit">Save</Button>
        </form>
      </section></Card>
    </main></Entrance>
  );
}
