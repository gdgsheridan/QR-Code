'use client';

import { motion, useReducedMotion } from 'motion/react';

// v0.12.4 (owner's request): the badge page's motion, drawn like the site's constellation background (glowing nodes,
// lines between them, terminal green). Decorative: the status line under the profile says the same in words.

const EASE = [0.22, 1, 0.36, 1] as const;
const STAR = 'rgba(184, 220, 255, 0.95)';
// A ring of sparks around the link's midpoint, a little flattened, two sizes.
const SPARKS = Array.from({ length: 14 }, (_, i) => {
  const a = (i / 14) * Math.PI * 2 + (i % 2) * 0.22;
  const r = 30 + (i % 3) * 13;
  return { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.72, s: i % 3 === 0 ? 2.6 : 1.7 };
});

/** The special one: a tap that just made (or completed) a connection, for a signed-in hacker. */
export function ConnectBurst({ kind, name }: { kind: 'mutual' | 'sent'; name: string | null }) {
  const reduce = useReducedMotion() ?? false;
  const mutual = kind === 'mutual';
  const at = (delay: number, duration = 0.55) => (reduce ? { duration: 0 } : { delay, duration, ease: EASE });
  const them = (name ?? 'them').length > 12 ? `${(name ?? 'them').slice(0, 11)}…` : (name ?? 'them');
  const other = mutual ? 'var(--accent)' : STAR;
  return (
    <div aria-hidden="true" data-testid="connect-burst" data-kind={kind}
      className="relative grid justify-items-center gap-[10px] pt-[8px] pb-[6px]">
      <svg viewBox="0 30 280 64" className="w-full max-w-[300px] h-auto overflow-visible">
        <defs>
          {/* userSpaceOnUse: a horizontal line has a zero-height box, and a box-relative filter region would hide it. */}
          <filter id="connect-glow" filterUnits="userSpaceOnUse" x="-40" y="-20" width="360" height="150">
            <feGaussianBlur stdDeviation="3.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {mutual ? (
          <>
            {/* The link draws itself, then a pulse runs it both ways. */}
            <motion.line x1="72" y1="52" x2="208" y2="52" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" filter="url(#connect-glow)"
              initial={reduce ? false : { pathLength: 0, opacity: 0.4 }} animate={{ pathLength: 1, opacity: 1 }} transition={at(0.45, 0.6)} />
            {!reduce && (
              <motion.circle cy="52" r="3.4" fill="#fff" filter="url(#connect-glow)"
                initial={{ cx: 72, opacity: 0 }} animate={{ cx: [72, 208, 72], opacity: [0, 1, 1, 0] }} transition={{ delay: 1.05, duration: 0.9, ease: 'easeInOut' }} />
            )}
            {!reduce && SPARKS.map((p, i) => (
              <motion.circle key={i} cx="140" cy="52" fill={i % 4 === 0 ? 'var(--accent)' : STAR}
                initial={{ r: 0, opacity: 0 }} animate={{ cx: 140 + p.x, cy: 52 + p.y, r: [0, p.s, 0], opacity: [0, 1, 0] }}
                transition={{ delay: 1.55 + (i % 5) * 0.03, duration: 0.95, ease: 'easeOut' }} />
            ))}
          </>
        ) : (
          <>
            {/* Waiting on them: a faint dotted path, signal dots travelling toward their node again and again. */}
            <line x1="72" y1="52" x2="208" y2="52" stroke={STAR} strokeOpacity="0.28" strokeWidth="1.6" strokeDasharray="2 7" strokeLinecap="round" />
            {!reduce && [0, 1, 2].map((i) => (
              <motion.circle key={i} cy="52" r="2.6" fill="var(--accent)" filter="url(#connect-glow)"
                initial={{ cx: 72, opacity: 0 }} animate={{ cx: [72, 208], opacity: [0, 1, 0] }}
                transition={{ delay: 0.7 + i * 0.42, duration: 1.25, ease: 'easeInOut', repeat: Infinity, repeatDelay: 0.35 }} />
            ))}
            {!reduce && (
              <motion.circle cx="220" cy="52" r="12" fill="none" stroke={STAR} strokeWidth="1.2"
                initial={{ scale: 1, opacity: 0 }} animate={{ scale: [1, 2.1], opacity: [0.5, 0] }}
                transition={{ delay: 1.2, duration: 1.4, ease: 'easeOut', repeat: Infinity, repeatDelay: 0.25 }} style={{ transformOrigin: '220px 52px' }} />
            )}
          </>
        )}

        {/* You and them: two nodes gliding in from the sides. */}
        <motion.g initial={reduce ? false : { x: -46, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={at(0)}>
          <circle cx="60" cy="52" r="11" fill="var(--bg)" stroke="var(--accent)" strokeWidth="2" filter="url(#connect-glow)" />
          <circle cx="60" cy="52" r="4.2" fill="var(--accent)" />
          <text x="60" y="84" textAnchor="middle" className="fill-[var(--fg)] font-mono text-[9.5px] uppercase tracking-[0.14em] opacity-60">you</text>
        </motion.g>
        <motion.g initial={reduce ? false : { x: 46, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={at(0.08)}>
          <motion.circle cx="220" cy="52" r="11" fill="var(--bg)" strokeWidth="2" filter="url(#connect-glow)"
            initial={reduce ? false : { stroke: STAR }} animate={{ stroke: other }} transition={at(mutual ? 1.0 : 0, 0.3)} />
          <motion.circle cx="220" cy="52" r="4.2" initial={reduce ? false : { fill: STAR }} animate={{ fill: other }} transition={at(mutual ? 1.0 : 0, 0.3)} />
          <text x="220" y="84" textAnchor="middle" className="fill-[var(--fg)] font-mono text-[9.5px] uppercase tracking-[0.14em] opacity-60">{them}</text>
        </motion.g>
      </svg>

      {/* One-way: the nodes and travelling dots say it (owner's request: no "> signal sent" line). */}
      {mutual && (
        <motion.p className="m-0 flex flex-wrap items-center justify-center gap-[8px] font-mono text-[12.5px] font-semibold tracking-[0.08em] text-accent"
          initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={at(1.5, 0.4)}>
          {/* Owner's request: just the +1, centred under the two nodes. */}
          <motion.span className="rounded-full px-[9px] py-[2px] text-[11px] font-bold tracking-[0.02em] text-[var(--accent-ink)] bg-[var(--accent)] shadow-[0_0_14px_rgba(52,211,153,0.45)]"
            initial={reduce ? false : { scale: 0, opacity: 0 }} animate={{ scale: [0, 1.15, 1], opacity: 1 }} transition={at(1.75, 0.45)}>
            +1 connection
          </motion.span>
        </motion.p>
      )}
    </div>
  );
}
