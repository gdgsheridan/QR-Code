'use client';

import { useLayoutEffect, useRef, useState } from 'react';

// v0.11.45 (F16 step 3): a bio shows its first 3 lines on the card; Read more opens the rest in place. The button
// only appears when the text is actually cut, which depends on the card's width. Without JavaScript the page's
// <noscript> style lifts the clamp (`bio-clamp`), so the whole bio still shows.
export function ClampedBio({ text }: { text: string }) {
  const bio = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const el = bio.current;
    if (!el || open) return;
    const measure = () => setCut(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [open]);
  return (
    <div className="grid justify-items-start gap-1">
      <p ref={bio} className={`bio-clamp copy m-0 whitespace-pre-line ${open ? '' : 'line-clamp-3'}`}>{text}</p>
      {(cut || open) && (
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
          className="inline-flex min-h-11 min-w-11 cursor-pointer items-center rounded-sm border-0 bg-transparent p-0 text-sm font-semibold text-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          {open ? 'Show less' : 'Read more'}
        </button>
      )}
    </div>
  );
}
