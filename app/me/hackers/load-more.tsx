'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useTransition } from 'react';
import { Button } from '@/components/ui/button';

// v0.11.46 (F16 step 4, owner's request): the next 50 load by themselves as the end of the list comes near, the
// same request (?show=N) as the Show more link. That link only shows without JavaScript, when nothing loads by itself.
export function LoadMore({ href, jump }: { href: string; jump: string }) {
  const router = useRouter();
  const end = useRef<HTMLDivElement>(null);
  const [loading, startLoading] = useTransition();
  useEffect(() => {
    const el = end.current;
    if (!el || loading) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) startLoading(() => router.replace(href, { scroll: false }));
    }, { rootMargin: '0px 0px 800px 0px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [href, loading, router]);
  return (
    <div className="grid justify-items-center gap-2">
      <div ref={end} aria-hidden="true" className="h-px w-full" />
      <p role="status" className="m-0 min-h-5 text-sm text-muted-foreground">{loading ? 'Loading more hackers…' : ''}</p>
      <noscript><Button variant="outline" asChild><a href={jump}>Show more</a></Button></noscript>
    </div>
  );
}
