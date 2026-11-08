'use client';

import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { isAttendeePage } from './attendee-pages';

const REDUCED = '(prefers-reduced-motion: reduce)';
const subscribe = (change: () => void) => {
  const query = window.matchMedia(REDUCED);
  query.addEventListener('change', change);
  return () => query.removeEventListener('change', change);
};

// §15 (v0.11.46, owner's request): wheel and trackpad scrolling glide on the attendee pages. Lenis keeps the page's
// native scroll, so sticky elements, IntersectionObserver, find-in-page and keyboard scrolling still work, and
// touch stays native. Never on staff pages, passes or badges, and never under reduced motion.
export function SmoothScroll() {
  const pathname = usePathname();
  const reduced = useSyncExternalStore(subscribe, () => window.matchMedia(REDUCED).matches, () => true);
  const on = isAttendeePage(pathname) && !reduced;
  const lenis = useRef<Lenis | null>(null);
  useEffect(() => {
    if (!on) return;
    // Scroll areas inside the page scroll natively, and the wheel over an open dialog never moves the page behind it.
    // naiveDimensions reads the page height on each scroll: the cached one went stale across client navigations
    // (made on /login, it still thought /me/hackers was a short page, so the wheel did nothing).
    const instance = new Lenis({ autoRaf: true, allowNestedScroll: true, naiveDimensions: true, prevent: (node) => node.closest('dialog') !== null });
    lenis.current = instance;
    return () => {
      instance.destroy();
      lenis.current = null;
    };
  }, [on]);
  // A navigation lands where Next put it, instead of gliding on toward the previous page's target.
  useEffect(() => {
    lenis.current?.scrollTo(window.scrollY, { immediate: true });
  }, [pathname]);
  return null;
}
