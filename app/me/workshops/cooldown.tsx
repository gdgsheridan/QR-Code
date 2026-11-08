'use client';

import { useEffect, useState } from 'react';
import { formatCountdown } from '@/lib/domain/countdown';

// SPEC F14 step 8: "Next workshop check-in in 4:10". `leftMs` is availableAt − the database clock when the page
// was rendered (I-7); this only measures elapsed time since then, so a wrong device clock can't shorten it.
export function CooldownTimer({ leftMs }: { leftMs: number }) {
  const [start] = useState(() => performance.now());
  const [now, setNow] = useState(start);
  const left = leftMs - (now - start);
  useEffect(() => {
    if (left <= 0) return;
    const t = setInterval(() => setNow(performance.now()), 1000);
    return () => clearInterval(t);
  }, [left]);
  if (left <= 0) {
    return <p role="status" className="m-0 font-semibold text-ok">✓ You can check in to your next workshop now.</p>;
  }
  return (
    <p className="m-0 grid gap-[2px]">
      <span className="text-muted-foreground text-[14px]">Next workshop check-in in</span>
      <span className="text-[32px] font-semibold leading-[1.1] tabular-nums" data-testid="cooldown-timer" aria-live="off">
        {formatCountdown(left)}
      </span>
    </p>
  );
}
