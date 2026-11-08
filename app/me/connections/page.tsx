import { BrandMark } from '@/components/brand-mark';
import { Entrance } from '@/components/motion';
import { Card } from '@/components/ui/card';
import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db/server';
import { myConnections, myRank } from '@/lib/me/connections';
import { loadMyEvent, menuMetadata } from '../load';
import { ConnectionList } from './list';

export const metadata: Metadata = menuMetadata('Connections');

// SPEC F17 (v0.12): all of the signed-in hacker's mutual connections and their own leaderboard rank. Who met
// whom is only ever shown to the two people involved; the ids come from the session (myEvent()), never a request.
export default async function ConnectionsPage() {
  const { me: m } = await loadMyEvent('/me/connections');
  const [mine, rank] = await Promise.all([myConnections(db(), m.participantId, 1000), myRank(db(), m.participantId)]);

  return (
    <Entrance><main className="max-w-[480px] lg:pointer-fine:max-w-[760px] m-[0px_auto] p-[24px_16px_56px] flex flex-col gap-[16px] [:where(&)_>_*]:mt-0 [:where(&)_>_*]:mb-0">
      <div className="flex items-center gap-[16px] min-h-[44px] mb-[8px]">
        <Link className="inline-flex shrink-0 items-center min-h-[44px] text-fg font-semibold no-underline [&:hover]:text-accent" href="/me">
          ← Menu
        </Link>
        <BrandMark name={m.event.name} className="max-w-[70%]" />
        <span aria-hidden="true" className="min-w-3 flex-1 h-px bg-[var(--edge)]" />
      </div>
      <h1>Connections</h1>
      <Card className="gap-2 [&>p]:m-0" asChild>
        <section aria-labelledby="score-heading">
          <h2 id="score-heading" className="sr-only">Your score</h2>
          <p className="text-[28px] font-semibold leading-[1.2]">
            {mine.total} {mine.total === 1 ? 'connection' : 'connections'}
          </p>
          {rank.rank != null && <p className="font-semibold text-accent">You’re #{rank.rank} on the leaderboard.</p>}
          <p className="text-muted-foreground text-[14px]">
            Tap someone’s badge and press Connect. It counts once they tap yours too.
            {mine.waitingOn > 0 && ` Waiting on ${mine.waitingOn} ${mine.waitingOn === 1 ? 'person' : 'people'} to tap you back.`}
          </p>
        </section>
      </Card>
      <Card className="[&>p]:m-0" asChild>
        <section aria-labelledby="people-heading">
          <h2 id="people-heading" className="text-lg">People you’ve met</h2>
          {mine.recent.length > 0 ? <ConnectionList people={mine.recent} /> : <p className="text-muted-foreground">No connections yet.</p>}
        </section>
      </Card>
    </main></Entrance>
  );
}
