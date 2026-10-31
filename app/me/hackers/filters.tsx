'use client';

import Form from 'next/form';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

const SEARCH_DEBOUNCE_MS = 400;
const REFRESH_COOLDOWN_MS = 5_000;

// v0.11.25 (F16 step 4): filters apply as they change: the pace and Looking controls at once, the name search
// shortly after typing stops. A soft navigation (next/form) keeps focus and scroll; without JavaScript it is
// a plain GET form (Enter submits).
export function AutoFilters({ className, children, label = 'Filter hackers' }: { className: string; children: ReactNode; label?: string }) {
  const form = useRef<HTMLFormElement>(null);
  const typing = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(typing.current), []);
  return (
    <Form ref={form} action="/me/hackers" replace scroll={false} aria-label={label} className={className}
      onChange={(e) => {
        clearTimeout(typing.current);
        const submit = () => form.current?.requestSubmit();
        if (e.target instanceof HTMLInputElement && e.target.type === 'search') typing.current = setTimeout(submit, SEARCH_DEBOUNCE_MS);
        else submit();
      }}>
      {children}
    </Form>
  );
}

// Reloads the list (new hackers, team changes), then rests: the server also limits directory reads per hacker.
export function RefreshButton() {
  const router = useRouter();
  const [resting, setResting] = useState(false);
  useEffect(() => {
    if (!resting) return;
    const t = setTimeout(() => setResting(false), REFRESH_COOLDOWN_MS);
    return () => clearTimeout(t);
  }, [resting]);
  return (
    <Button type="button" variant="outline" disabled={resting} onClick={() => { setResting(true); router.refresh(); }}>
      Refresh
    </Button>
  );
}
