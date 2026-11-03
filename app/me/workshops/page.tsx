import { BrandMark } from '@/components/brand-mark';
import { Entrance } from '@/components/motion';
import { Card } from '@/components/ui/card';
import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db/server';
import { remainingMs } from '@/lib/domain/countdown';
import { formatEventDateTime } from '@/lib/domain/event-time';
import { myWorkshops } from '@/lib/me/workshops';
import { loadMyEvent, menuMetadata } from '../load';
import { CooldownTimer } from './cooldown';

export const metadata: Metadata = menuMetadata('Workshops');

// SPEC F14 step 8: the workshops the signed-in hacker was checked in to (their badge or QR scanned at a
// session checkpoint), newest first, in the event timezone (I-8), and the cooldown before the next one.
export default async function WorkshopsPage() {
  const { me: m } = await loadMyEvent('/me/workshops');
  const mine = await myWorkshops(db(), m.participantId);
  const left = mine.availableAt ? remainingMs(mine.availableAt, mine.serverTime) : 0;
  const count = mine.workshops.length;

  return (
    <Entrance><main className="max-w-[480px] lg:pointer-fine:max-w-[760px] m-[0px_auto] p-[24px_16px_56px] flex flex-col gap-[16px] [:where(&)_>_*]:mt-0 [:where(&)_>_*]:mb-0">
      <div className="flex items-center gap-[16px] min-h-[44px] mb-[8px]">
        <Link className="inline-flex shrink-0 items-center min-h-[44px] text-fg font-semibold no-underline [&:hover]:text-accent" href="/me">
          ← Menu
        </Link>
        <BrandMark name={m.event.name} className="max-w-[70%]" />
        <span aria-hidden="true" className="min-w-3 flex-1 h-px bg-[var(--edge)]" />
      </div>
      <h1>Workshops</h1>
      <Card className="gap-2 [&>p]:m-0" asChild>
        <section aria-labelledby="attended-heading">
          <h2 id="attended-heading" className="text-[28px] font-semibold leading-[1.2]">
            {count} {count === 1 ? 'workshop' : 'workshops'} attended
          </h2>
          <p className="text-muted-foreground text-[14px]">
            Tap your badge (or show your pass) at the workshop door to check in.
            {mine.cooldownMinutes > 0 && ` Check-ins to different workshops need ${mine.cooldownMinutes} minutes between them.`}
          </p>
          {left > 0 && <CooldownTimer leftMs={left} />}
        </section>
      </Card>
      <Card className="[&>p]:m-0" asChild>
        <section aria-labelledby="list-heading">
          <h2 id="list-heading" className="text-lg">Checked in</h2>
          {count === 0 ? (
            <p className="text-muted-foreground">No workshops yet.</p>
          ) : (
            <ol className="m-0 p-0 list-none grid [&_li_+_li]:[border-top-width:1px] [&_li_+_li]:[border-top-style:solid] [&_li_+_li]:[border-top-color:var(--line)]">
              {mine.workshops.map((w) => (
                <li key={`${w.name}-${w.scannedAt}`} className="grid gap-[2px] min-h-[48px] py-[8px]">
                  <span className="font-semibold [overflow-wrap:anywhere]">{w.name}</span>
                  <span className="text-muted-foreground text-[13px]">{formatEventDateTime(w.scannedAt, m.event.timezone)}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </Card>
    </main></Entrance>
  );
}
