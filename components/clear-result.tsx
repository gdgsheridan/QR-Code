'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

// v0.11.47: a result message (?r=, and a refused join code) shows once. It leaves the URL, so a reload or a shared
// link never repeats an old one ("You joined the team" after being removed). Keyed on the search params: an action's
// redirect lands on the same, still-mounted page.
export function ClearResult() {
  const params = useSearchParams();
  useEffect(() => {
    if (!params.has('r') && !params.has('code')) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('r');
    url.searchParams.delete('code');
    window.history.replaceState(window.history.state, '', url);
  }, [params]);
  return null;
}
