import { Entrance } from '@/components/motion';
import { BrandMark } from '@/components/brand-mark';
import { Card } from '@/components/ui/card';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { headers } from 'next/headers';
import { z } from 'zod';
import { db } from '@/lib/db/server';
import { clientIpKey } from '@/lib/http/ip';
import { IP_CEILING_PER_MIN, withinLimit } from '@/lib/pass/handlers';
import { judgeById } from '@/lib/admin/judges';
import { JudgeCard } from '@/app/profile/[uid]/judge-card';

// SPEC §11 Judges (v0.12.4, owner's request): a judge's own page, the same card their badge opens, so organizers can
// open it before (or without) a badge. Public like the badge page; the id is a random uuid.
export const metadata: Metadata = {
  title: 'Judge · Datathon',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

export default async function JudgePage(props: { params: Promise<{ id: string }> }) {
  await connection(); // per request: a LinkedIn edited on the Judges tab shows at once
  const id = z.uuid().safeParse((await props.params).id).data;
  if (!id) notFound();
  if (!(await withinLimit(db(), clientIpKey(await headers(), 'profile'), 60, IP_CEILING_PER_MIN))) notFound();
  const judge = await judgeById(db(), id, new Date());
  if (!judge) notFound();
  return (
    <Entrance><main className="max-w-[520px] m-[0px_auto] p-[24px_16px_56px] flex flex-col gap-[16px] [:where(&)_>_*]:mt-0 [:where(&)_>_*]:mb-0">
      <BrandMark className="min-h-11 mb-[8px]" />
      <Card className="[&>p]:m-0 [&>h2]:text-lg " asChild><section>
        <JudgeCard judge={judge} />
      </section></Card>
    </main></Entrance>
  );
}
