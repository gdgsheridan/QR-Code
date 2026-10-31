'use client';

import { createContext, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { stagger, useAnimate } from 'motion/react';

// v0.11.29 (owner's request): every new page's sections rise into place one after another ("staggered rise").
// The sections are the blocks one level inside the page (the template wrapper's grandchildren: cards, the menu,
// tables), found at mount, so no page needs markup for it. Templates mount a fresh copy on each navigation while
// layouts persist, so this plays on every new page and tab without moving the headers above it.
// The first page load keeps its server HTML visible without JavaScript: it rises with the CSS class `page-rise`
// (globals.css). Once hydrated, client navigations rise with Framer Motion.

let hydrated = false;
export const PAGE_RISE_TRANSITION = { duration: 0.32, ease: [0.23, 1, 0.32, 1] as const, delay: stagger(0.04) };

// A template that mounts in the same commit as its parent template (say /login → /me) leaves the animation to the
// parent, so the page doesn't rise twice. The parent's effect marks it mounted after that first commit.
const Parent = createContext<{ mounted: boolean } | null>(null);

// After a template's first commit: the app is hydrated, and templates mounting from now on are not its first commit.
function markMounted(template: { mounted: boolean }) {
  hydrated = true;
  template.mounted = true;
}

export function PageTransition({ children }: { children: ReactNode }) {
  const parent = useContext(Parent);
  const [self] = useState(() => ({ mounted: false }));
  const [skip] = useState(() => parent !== null && !parent.mounted);
  // Decided once at mount: CSS on the first load, Framer Motion after, nothing with reduced motion.
  const [mode] = useState<'css' | 'motion' | 'still'>(() =>
    !hydrated ? 'css' : window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'still' : 'motion');
  const [scope, animate] = useAnimate<HTMLDivElement>();
  useEffect(() => markMounted(self), [self]);
  // Before paint, so a client-side page never shows its sections in place first.
  useLayoutEffect(() => {
    if (skip || mode !== 'motion' || !scope.current) return;
    const sections = Array.from(scope.current.children).flatMap((child) => Array.from(child.children));
    if (sections.length === 0) return;
    const rise = animate(sections, { opacity: [0, 1], y: [12, 0] }, PAGE_RISE_TRANSITION);
    return () => rise.stop();
  }, [animate, mode, scope, skip]);

  if (skip) return <Parent value={self}>{children}</Parent>;
  return (
    <Parent value={self}>
      <div ref={scope} data-page="" className={mode === 'css' ? 'page-rise min-w-0' : 'min-w-0'}>{children}</div>
    </Parent>
  );
}
