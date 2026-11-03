import { ConnectionStats } from './connection-stats';
import { Leaderboard } from './leaderboard';

// SPEC F17 step 6 (v0.12): the connection leaderboard for the projector (organizers; the layout checks the role).
export default async function LeaderboardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <div className="grid gap-[24px]">
      <Leaderboard slug={slug} />
      <ConnectionStats slug={slug} />
    </div>
  );
}
