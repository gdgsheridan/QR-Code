'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminUrl, errorText, useApi } from '../api';
import { BucketChart } from '../arrivals-chart';
import { Tile } from '../dashboard';

interface ConnectionData {
  timezone: string;
  mutual: number;
  waiting: number;
  checkedIn: number;
  connectedPeople: number;
  connectedShare: number;
  buckets: Array<{ bucketUtc: string; label: string; count: number }>;
}

const POLL_MS = 10_000;

// SPEC §13 (F17): how the connection game is going. Totals only: organizers never see who met whom.
// Below the board, so the projector's full screen shows only the board.
export function ConnectionStats({ slug }: { slug: string }) {
  const api = useApi();
  const [data, setData] = useState<ConnectionData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api<ConnectionData>(adminUrl(slug, '/analytics/connections'));
    if (r.ok) {
      setData(r.data);
      setError(null);
    } else if (r.status !== 401) setError(errorText(r));
  }, [api, slug]);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const t = setInterval(() => document.visibilityState === 'visible' && void load(), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

  return (
    <section aria-labelledby="conn-stats-heading" className="grid gap-[14px]">
      <h2 id="conn-stats-heading" className="m-0">Connection stats</h2>
      {!data ? (
        <p className="text-muted-foreground text-[13px]">{error ? `✕ ${error}` : 'Loading…'}</p>
      ) : (
        <>
          <div className="grid [grid-template-columns:repeat(auto-fit,_minmax(min(100%,_210px),_1fr))] gap-[14px]
              max-[600.001px]:[grid-template-columns:repeat(2,_minmax(0px,_1fr))] max-[600.001px]:gap-[10px]
              max-[360.001px]:[grid-template-columns:minmax(0px,_1fr)]">
            <Tile id="conn-mutual" label="Connections made" value={data.mutual} hint="both people tapped" />
            <Tile id="conn-people" label="Hackers connected" value={data.connectedPeople} hint={`${Math.round(data.connectedShare * 100)}% of ${data.checkedIn} checked in`} />
            <Tile id="conn-waiting" label="Waiting for a tap back" value={data.waiting} hint="one-way taps" />
          </div>
          <h3 className="m-0 text-[16px]">Connections per hour</h3>
          <BucketChart
            buckets={data.buckets}
            timezone={data.timezone}
            minutes={60}
            noun={['connection', 'connections']}
            title="Connections made per hour"
            column="Connections"
            empty="No connections yet."
          />
          <p className="text-muted-foreground text-[12px] leading-[1.7]">Test and deleted participants are left out. Who met whom is never shown here.</p>
        </>
      )}
    </section>
  );
}
