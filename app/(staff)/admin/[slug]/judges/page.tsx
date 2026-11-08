import { env } from '@/lib/env';
import { Judges } from './judges';

export default async function JudgesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { BADGE_ORIGIN, NEXT_PUBLIC_APP_ORIGIN } = env();
  return <Judges slug={slug} badgeOrigin={BADGE_ORIGIN ?? NEXT_PUBLIC_APP_ORIGIN} />;
}
