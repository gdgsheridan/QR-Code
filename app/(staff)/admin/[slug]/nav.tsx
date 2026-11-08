'use client';

import Link from 'next/link';
import { motion, useReducedMotion } from 'motion/react';
import { usePathname } from 'next/navigation';

const TABS = [
  ['', 'Dashboard'],
  ['/participants', 'Participants'],
  ['/teams', 'Teams'],
  ['/workshops', 'Workshops'],
  ['/leaderboard', 'Leaderboard'],
  ['/judges', 'Judges'],
  ['/checkpoints', 'Checkpoints'],
  ['/catering', 'Catering'],
  ['/staff', 'Staff'],
  ['/schedule', 'Schedule'],
  ['/info', 'Info'],
  ['/tools', 'Tools'],
] as const;

export function AdminNav({ slug }: { slug: string }) {
  const pathname = usePathname();
  const reduced = useReducedMotion();
  const base = `/admin/${slug}`;
  return (
    <nav aria-label="Admin" onFocus={(event) => event.target.scrollIntoView({ block: 'nearest', inline: 'nearest' })}
      className="flex justify-start items-center flex-nowrap gap-[8px] max-[1700px]:gap-[2px] overflow-x-auto overflow-y-hidden
          max-w-full min-w-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {TABS.map(([path, label]) => {
        const href = base + path;
        return (
          <Link key={label} href={href} className="tw-admin-tab relative inline-flex items-center min-h-[48px] p-[0px_16px] text-muted-foreground no-underline

          [border-bottom:2px_solid_transparent] whitespace-nowrap [flex:0_0_auto] justify-center

          rounded-t-lg text-[1rem] font-semibold

          [transition:color_180ms_var(--ease),_background-color_180ms_var(--ease),_border-color_180ms_var(--ease)]

          [padding-inline:16px] max-[1700px]:[padding-inline:8px] max-[1700px]:text-[0.875rem] max-[600.001px]:min-h-[44px] max-[600.001px]:text-[0.875rem]

          max-[600.001px]:[padding-inline:12px] [&[aria-current='page']]:text-accent

          [&[aria-current='page']]:font-bold [&[aria-current='page']]:[border-bottom-color:var(--accent)]

          [&[aria-current='page']]:[background:color-mix(in_srgb,_var(--accent)_8%,_transparent)]

          [&:hover]:text-fg [&:hover]:[background:color-mix(in_srgb,_var(--accent)_6%,_transparent)]

          [&:focus-visible]:z-[1] [&:focus-visible]:[outline:2px_solid_var(--accent)]

          [&:focus-visible]:[outline-offset:-3px]" aria-current={pathname === href ? 'page' : undefined}>
            {label}
            {pathname === href && <motion.span aria-hidden="true" className="absolute inset-x-0 bottom-[-2px] h-0.5 bg-primary" layoutId={reduced ? undefined : 'admin-active-tab'} transition={{ duration: reduced ? 0 : 0.16, ease: 'easeOut' }} />}
          </Link>
        );
      })}
      <Link href={`/scan/${slug}`} className="tw-admin-tab relative inline-flex items-center min-h-[48px] p-[0px_16px] text-muted-foreground no-underline

          [border-bottom:2px_solid_transparent] whitespace-nowrap [flex:0_0_auto] justify-center

          rounded-t-lg text-[1rem] font-semibold

          [transition:color_180ms_var(--ease),_background-color_180ms_var(--ease),_border-color_180ms_var(--ease)]

          [padding-inline:16px] max-[1700px]:[padding-inline:8px] max-[1700px]:text-[0.875rem] max-[600.001px]:min-h-[44px] max-[600.001px]:text-[0.875rem]

          max-[600.001px]:[padding-inline:12px] [&[aria-current='page']]:text-accent

          [&[aria-current='page']]:font-bold [&[aria-current='page']]:[border-bottom-color:var(--accent)]

          [&[aria-current='page']]:[background:color-mix(in_srgb,_var(--accent)_8%,_transparent)]

          [&:hover]:text-fg [&:hover]:[background:color-mix(in_srgb,_var(--accent)_6%,_transparent)]

          [&:focus-visible]:z-[1] [&:focus-visible]:[outline:2px_solid_var(--accent)]

          [&:focus-visible]:[outline-offset:-3px]">
        Scanner ↗
      </Link>
    </nav>
  );
}
