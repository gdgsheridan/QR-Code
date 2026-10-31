'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DISCORD_URL, GOOGLE_GROUP_URL, HACKER_PACKAGE_URL } from '@/lib/email/links';
import { BookIcon, ChevronIcon, DiscordIcon, LinkIcon, MegaphoneIcon } from './icons';

const LINKS = [
  [DISCORD_URL, 'Discord', DiscordIcon],
  [HACKER_PACKAGE_URL, 'Hacker package', BookIcon],
  [GOOGLE_GROUP_URL, 'Google Group', MegaphoneIcon],
] as const;

// v0.11.28 (owner's request): the event's links as a hacker-menu row that opens in place, like a dropdown.
// The panel slides open (grid rows 0fr → 1fr) and the chevron turns down; reduced motion skips both animations.
// Closed, the links are inert so the keyboard never lands on hidden ones.
export function LinksDropdown() {
  const [open, setOpen] = useState(false);
  const panel = useId();
  return (
    <li>
      <button type="button" aria-expanded={open} aria-controls={panel} onClick={() => setOpen((o) => !o)}
        className="tw-me-item flex w-full items-center gap-[14px] min-h-[64px] p-[10px_16px] text-left [color:inherit] [font:inherit] bg-transparent border-0 cursor-pointer
          [transition:background-color_0.16s_var(--ease)] [&:hover]:[background:var(--raised)] [&:focus-visible]:[outline-offset:-2px] [&:focus-visible]:rounded-card">
        <LinkIcon className="tw-me-itemIcon [flex:0_0_auto] w-[22px] h-[22px] text-accent" />
        <span className="tw-me-itemText grid flex-1 min-w-0 [overflow-wrap:anywhere] text-[16px] font-semibold [&_small]:text-muted-foreground [&_small]:text-[13px] [&_small]:font-normal">
          Links
          <small>Discord and event links</small>
        </span>
        <ChevronIcon className={`tw-me-chevron [flex:0_0_auto] w-[18px] h-[18px] text-muted-foreground motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out ${open ? 'rotate-90' : ''}`} />
      </button>
      <div id={panel} className={`grid motion-safe:transition-[grid-template-rows] motion-safe:duration-200 motion-safe:ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="min-h-0 overflow-hidden" inert={!open}>
          <div className={`flex flex-wrap gap-[8px] p-[2px_16px_16px_52px] motion-safe:transition-opacity motion-safe:duration-200 ${open ? 'opacity-100' : 'opacity-0'}`}>
            {LINKS.map(([href, label, Mark]) => (
              <Button key={label} variant="outline" asChild>
                <a href={href} target="_blank" rel="noopener noreferrer" className="gap-[8px]"><Mark className="w-[18px] h-[18px] text-accent" />{label}</a>
              </Button>
            ))}
          </div>
        </div>
      </div>
    </li>
  );
}
