'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import styles from './atom-float.module.css';

// Clearance from the page's content and from the window edges, in px.
const GAP = 16;
const EDGE = 14;
// Drift speed, px/s, and how long one slow tilt back and forth takes, s.
const SPEED = 14;
const TILT_PERIOD = 20;
const VELOCITY_WINDOW = 80; // ms
const RECENT_MOVE = 120; // ms: a slower pointer's last move still counts toward the throw
const MAX_TOSS_SPEED = 2500; // px/s
const RESTITUTION = 0.6;
const FRICTION = 2; // exponential speed decay, per second
const STEP = 8; // px: moves are taken in steps this small, so a fast throw can't pass through the content
const GLIDE = 220; // px/s: let go over the content, he floats off it at least this fast
const REST_TILT = 6; // degrees either way, over TILT_PERIOD
// Owner's request: held, he swings like he's dangling from the pointer. His tilt follows a spring toward a lean away
// from the way he's carried (LEAN degrees per px/s of his horizontal speed; never past MAX_LEAN), so he swings a little
// when you stop; let go, a better-damped spring takes him back to his rest tilt with a short wobble (about 0.9 s).
const LEAN = 0.02;
const MAX_LEAN = 25;
const CARRY_SMOOTHING = 0.06; // s
const HELD = { k: 120, c: 9 }; // stiffness 1/s², damping 1/s: about 1.7 swings a second, damping ratio 0.4
const SETTLE = { k: 81, c: 9 }; // damping ratio 0.5
const GRAB_SPRITE = '/atom-grab.webp';

type Sample = { x: number; y: number; t: number };
type Drag = { pointerId: number; offsetX: number; offsetY: number; samples: Sample[]; moved: boolean };
// `leaving` while he floats off the content after being dropped on it.
// `tilt` (degrees) and `spin` (degrees/s) are his rotation and its speed.
type Drift = {
  el: HTMLDivElement; x: number; y: number; vx: number; vy: number; phase: number; leaving: boolean; tilt: number; spin: number;
};
type Rect = { left: number; top: number; right: number; bottom: number };

// Owner's request: Atom waves now and then. public/atom-wave.webp holds his 8-frame wave (frame 1 is the still Atom);
// a wave steps the background across the frames in 0.9 s, the first 2-8 s after he appears, then every 8-20 s, twice
// in a row about one time in three. Reduced motion: never. Returns the cleanup.
function waveNowAndThen(el: HTMLElement) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};
  let timer = 0;
  const next = (min: number, max: number) => {
    timer = window.setTimeout(() => {
      if (el.offsetWidth && !el.dataset.dragging) { // not while hidden (no room at this width) or held
        el.animate({ backgroundPositionX: ['0%', '100%'] },
          { id: 'wave', duration: 900, easing: 'steps(8, jump-none)', iterations: Math.random() < 0.3 ? 2 : 1 });
      }
      next(8000, 20000);
    }, min + Math.random() * (max - min));
  };
  next(2000, 8000);
  return () => window.clearTimeout(timer);
}

const sprite = { backgroundImage: 'url(/atom-wave.webp)' };

// The small Atom in the /me hero card's corner (app/me/page.tsx), for widths without room for the floating one.
export function AtomCorner({ className }: { className: string }) {
  const atom = useRef<HTMLSpanElement>(null);
  useEffect(() => atom.current ? waveNowAndThen(atom.current) : undefined, []);
  return <span ref={atom} aria-hidden="true" data-atom-corner="" className={`${styles.sprite} ${className}`} style={sprite} />;
}

// v0.11.30 (owner's request): Atom floats in the window around the page's content. A fresh load puts him beside the
// content on a random side, at a random spot heading a random way; then he drifts at a constant slow speed with a slow
// tilt, bouncing gently off the window's edges and off the content (the page's <main>), which he never crosses: to
// reach the other side he goes around it. He can be dragged anywhere, over the content too; let go there, he floats off
// it (keeping any throw). Tossed, he bounces off the content and the window edges. He lives in the root layout, so
// navigating keeps him drifting. Reduced motion: placed, then still; a drag still moves him, and a drop over the
// content puts him beside it at once.
export function AtomFloat() {
  const pathname = usePathname();
  const attendee = pathname === '/me' || pathname.startsWith('/me/');
  const shown = attendee || ['/rsvp', '/login', '/set-password', '/auth/confirm'].includes(pathname);
  const lane = useRef<HTMLDivElement>(null);
  const atom = useRef<HTMLDivElement>(null);
  // Where he is, kept across route changes; a new image (back from a page without him) starts afresh.
  const drift = useRef<Drift | null>(null);

  useEffect(() => {
    const box = lane.current;
    const el = atom.current;
    if (!box || !el) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let drag: Drag | null = null;
    let grab: Animation | undefined;
    let lastX = 0;
    let carried = 0; // px/s: his horizontal speed while held, smoothed
    const size = () => ({ w: el.offsetWidth, h: el.offsetHeight || el.offsetWidth }); // square
    // Room for his tilt around the box (his ±6° rest tilt, more while he swings), so a rotated corner never touches the
    // content or a window edge.
    const overhang = () => {
      if (still) return 0;
      const angle = Math.max(REST_TILT, Math.abs(drift.current?.tilt ?? 0)) * Math.PI / 180;
      return el.offsetWidth * (Math.sin(angle) + Math.cos(angle) - 1) / 2 + 1; // + 1px so rounding never touches an edge
    };
    // The most he may lean once let go: what his rotated corners can fit into the free space beside the content on his
    // side (GAP + EDGE clearance included). Held, he may swing to MAX_LEAN; let go, the wobble never outgrows the space.
    const fitLean = (d: Drift) => {
      const main = document.querySelector('main')?.getBoundingClientRect();
      if (!main) return REST_TILT;
      const w = el.offsetWidth;
      const gutter = d.x + w / 2 < box.clientWidth / 2 ? main.left : box.clientWidth - main.right;
      const room = Math.max(0, gutter - w - GAP - EDGE - 2); // what's left for both overhangs (each has its 1px)
      // overhang(θ) = w (sin θ + cos θ − 1) / 2 per side, so 2·overhang ≤ room ⇔ sin(θ + 45°) ≤ (1 + room / w) / √2.
      const s = (1 + room / w) / Math.SQRT2;
      const fit = s >= 1 ? 45 : Math.asin(s) * 180 / Math.PI - 45;
      return Math.max(REST_TILT, Math.min(MAX_LEAN, fit));
    };
    // The content he goes around: the page's <main>, as it sits in the window now (it moves when the page scrolls).
    const content = (): Rect => {
      const pad = GAP + overhang();
      const main = document.querySelector('main')?.getBoundingClientRect();
      if (main) return { left: main.left - pad, top: main.top - pad, right: main.right + pad, bottom: main.bottom + pad };
      const column = parseFloat(getComputedStyle(box).getPropertyValue('--atom-column')) || 760;
      const left = (box.clientWidth - column) / 2 - pad;
      return { left, top: -Infinity, right: box.clientWidth - left, bottom: Infinity };
    };
    const area = () => {
      const { w, h } = size();
      const inset = overhang();
      return { minX: EDGE + inset, maxX: box.clientWidth - EDGE - inset - w, minY: inset, maxY: box.clientHeight - inset - h };
    };
    // Keep him in the window and (unless held or leaving it) out of the content; bounce (scaled by `bounce`) the
    // velocity he hit with.
    const overlaps = (d: Drift, c: Rect) => {
      const { w, h } = size();
      return d.x + w > c.left && d.x < c.right && d.y + h > c.top && d.y < c.bottom;
    };
    const resolve = (d: Drift, bounce: number) => {
      const a = area();
      if (d.x < a.minX) { d.x = a.minX; if (d.vx < 0) d.vx *= -bounce; }
      if (d.x > a.maxX) { d.x = a.maxX; if (d.vx > 0) d.vx *= -bounce; }
      if (d.y < a.minY) { d.y = a.minY; if (d.vy < 0) d.vy *= -bounce; }
      if (d.y > a.maxY) { d.y = a.maxY; if (d.vy > 0) d.vy *= -bounce; }
      if (drag || d.leaving) return;
      const { w, h } = size();
      const c = content();
      if (!overlaps(d, c)) return;
      // Inside the content's box: out by the shortest way the window allows, bouncing off that face.
      const left = c.left - w >= a.minX ? d.x + w - c.left : Infinity;
      const right = c.right <= a.maxX ? c.right - d.x : Infinity;
      const up = c.top - h >= a.minY ? d.y + h - c.top : Infinity;
      const down = c.bottom <= a.maxY ? c.bottom - d.y : Infinity;
      const least = Math.min(left, right, up, down);
      if (least === Infinity) return; // the content fills the window; nowhere to go
      if (least === left) { d.x = c.left - w; if (d.vx > 0) d.vx *= -bounce; }
      else if (least === right) { d.x = c.right; if (d.vx < 0) d.vx *= -bounce; }
      else if (least === up) { d.y = c.top - h; if (d.vy > 0) d.vy *= -bounce; }
      else { d.y = c.bottom; if (d.vy < 0) d.vy *= -bounce; }
    };
    // Move by (dx, dy) in small steps, resolving each, so a fast throw bounces off the content instead of jumping it.
    const move = (d: Drift, dx: number, dy: number, bounce: number) => {
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / STEP));
      for (let i = 0; i < steps; i++) {
        d.x += dx / steps;
        d.y += dy / steps;
        resolve(d, bounce);
      }
    };
    const restTilt = (d: Drift, seconds: number) => still ? 0 : REST_TILT * Math.sin((seconds / TILT_PERIOD) * 2 * Math.PI + d.phase);
    const swing = (d: Drift, dt: number, seconds: number) => {
      if (dt <= 0) return;
      carried = drag ? carried + ((d.x - lastX) / dt - carried) * Math.min(1, dt / CARRY_SMOOTHING) : 0;
      lastX = d.x;
      const target = drag ? Math.max(-MAX_LEAN, Math.min(MAX_LEAN, -carried * LEAN)) : restTilt(d, seconds);
      const { k, c } = drag ? HELD : SETTLE;
      d.spin += (k * (target - d.tilt) - c * d.spin) * dt;
      // A hard stop at MAX_LEAN while held, and at what fits beside the content once let go (bounding overhang()).
      const limit = drag ? MAX_LEAN : fitLean(d);
      d.tilt = Math.max(-limit, Math.min(limit, d.tilt + d.spin * dt));
      if (Math.abs(d.tilt) === limit) d.spin = 0;
    };
    const draw = (d: Drift) => {
      el.style.transform = `translate(${d.x}px, ${d.y}px) rotate(${d.tilt}deg)`;
    };
    // Back to the wave sprite on frame 1 (the wave timer keeps going).
    const letGo = () => {
      grab?.cancel();
      grab = undefined;
      el.style.backgroundImage = sprite.backgroundImage;
    };
    let frame = 0;
    let last = 0;
    let running = false;
    // The loop stops while he's hidden (no room at this width) and when reduced motion has placed him.
    const start = () => {
      if (running) return;
      running = true;
      last = performance.now();
      frame = requestAnimationFrame(tick);
    };
    const tick = (now: number) => {
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
      last = now;
      if (box.clientWidth === 0) { running = false; return; }
      let d = drift.current;
      if (d && d.el === el && !still) swing(d, dt, now / 1000);
      if (!d || d.el !== el) {
        // Beside the content, on a random side.
        const a = area();
        const c = content();
        const { w } = size();
        const right = Math.random() < 0.5;
        const from = right ? Math.max(a.minX, c.right) : a.minX;
        const to = right ? a.maxX : Math.min(a.maxX, c.left - w);
        const heading = Math.random() * 2 * Math.PI;
        d = drift.current = {
          el, x: from + Math.random() * Math.max(0, to - from), y: a.minY + (a.maxY - a.minY) * (0.08 + Math.random() * 0.84),
          vx: SPEED * Math.cos(heading), vy: SPEED * Math.sin(heading), phase: Math.random() * 2 * Math.PI, leaving: false,
          tilt: 0, spin: 0,
        };
        d.tilt = restTilt(d, now / 1000);
        resolve(d, 1);
        el.style.opacity = '1';
      } else if (!still && !drag) {
        if (d.leaving) {
          // Floating off the content: keep at least GLIDE toward its nearest edge until he's clear of it.
          const c = content();
          if (!overlaps(d, c)) d.leaving = false;
          else {
            const { w, h } = size();
            const a = area();
            // Only edges he can get past without leaving the window (a page taller than the window has no top or
            // bottom way out); the nearest of those.
            const exits = [
              { d: d.x + w - c.left, vx: -1, vy: 0, open: c.left - w >= a.minX },
              { d: c.right - d.x, vx: 1, vy: 0, open: c.right <= a.maxX },
              { d: d.y + h - c.top, vx: 0, vy: -1, open: c.top - h >= a.minY },
              { d: c.bottom - d.y, vx: 0, vy: 1, open: c.bottom <= a.maxY },
            ].sort((p, q) => Number(q.open) - Number(p.open) || p.d - q.d);
            const exit = exits[0]!;
            if (exit.vx !== 0 && d.vx * exit.vx < GLIDE) d.vx = exit.vx * GLIDE;
            if (exit.vy !== 0 && d.vy * exit.vy < GLIDE) d.vy = exit.vy * GLIDE;
          }
        }
        const bounce = Math.hypot(d.vx, d.vy) > SPEED ? RESTITUTION : 1;
        move(d, d.vx * dt, d.vy * dt, bounce);
        const speed = Math.hypot(d.vx, d.vy);
        if (speed > SPEED) {
          const nextSpeed = Math.max(SPEED, speed * Math.exp(-FRICTION * dt));
          d.vx *= nextSpeed / speed;
          d.vy *= nextSpeed / speed;
        }
      } else {
        // Held or still: the content may have moved under him (a scroll, a route, a resize).
        resolve(d, 1);
      }
      draw(d);
      if (still) { running = false; return; }
      frame = requestAnimationFrame(tick);
    };
    const onPointerDown = (event: PointerEvent) => {
      const d = drift.current;
      if (drag || event.button !== 0 || !d || d.el !== el || box.clientWidth === 0) return;
      event.preventDefault();
      el.setPointerCapture(event.pointerId);
      drag = {
        pointerId: event.pointerId,
        offsetX: event.clientX - d.x,
        offsetY: event.clientY - d.y,
        samples: [{ x: event.clientX, y: event.clientY, t: event.timeStamp }], moved: false,
      };
      el.dataset.dragging = 'true';
      // Owner's request: picked up, he flails (public/atom-grab.webp: 8 frames, looped at 10 fps until let go).
      if (!still) {
        el.getAnimations().find((animation) => animation.id === 'wave')?.cancel();
        el.style.backgroundImage = `url(${GRAB_SPRITE})`;
        grab = el.animate({ backgroundPositionX: ['0%', '100%'] },
          { duration: 800, easing: 'steps(8, jump-none)', iterations: Infinity });
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      const d = drift.current;
      if (!drag || drag.pointerId !== event.pointerId || !d) return;
      const first = drag.samples[0];
      if (first && Math.hypot(event.clientX - first.x, event.clientY - first.y) > 3) drag.moved = true;
      drag.samples.push({ x: event.clientX, y: event.clientY, t: event.timeStamp });
      if (drag.samples.length > 8) drag.samples.shift();
      move(d, event.clientX - drag.offsetX - d.x, event.clientY - drag.offsetY - d.y, 0);
      draw(d);
    };
    const onPointerEnd = (event: PointerEvent) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const released = event.type === 'pointerup';
      if (released) onPointerMove(event);
      const d = drift.current;
      // The throw is measured over the last VELOCITY_WINDOW ms; on a slow pointer (few moves), from the move before
      // release if that was recent. Holding still before letting go measures nothing, so he isn't tossed.
      const end = drag.samples[drag.samples.length - 1];
      const previous = drag.samples[drag.samples.length - 2];
      const first = end && (drag.samples.find((sample) => sample !== end && sample.t >= end.t - VELOCITY_WINDOW)
        ?? (previous && end.t - previous.t <= RECENT_MOVE ? previous : undefined));
      if (released && !still && drag.moved && d && first && end) {
        const previousSpeed = Math.hypot(d.vx, d.vy) || SPEED;
        d.vx *= SPEED / previousSpeed;
        d.vy *= SPEED / previousSpeed;
        const seconds = Math.max(1, end.t - first.t) / 1000;
        const vx = (end.x - first.x) / seconds;
        const vy = (end.y - first.y) / seconds;
        const speed = Math.hypot(vx, vy);
        if (speed > SPEED) {
          const scale = Math.min(speed, MAX_TOSS_SPEED) / speed;
          d.vx = vx * scale;
          d.vy = vy * scale;
        }
      }
      drag = null;
      delete el.dataset.dragging;
      letGo();
      // Let go, his lean drops at once to what fits beside the content (he may lean further only while held).
      if (d && !still) {
        const limit = fitLean(d);
        d.tilt = Math.max(-limit, Math.min(limit, d.tilt));
      }
      // Dropped on the content: float off it (reduced motion: beside it at once).
      if (d && overlaps(d, content())) {
        d.leaving = !still;
        if (still) { resolve(d, 1); draw(d); }
      }
      if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
    };
    const onResize = () => {
      const d = drift.current;
      if (d && d.el === el && box.clientWidth > 0) {
        resolve(d, 1);
        draw(d);
      }
      start();
    };
    const preventDrag = (event: Event) => event.preventDefault();
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerEnd);
    el.addEventListener('pointercancel', onPointerEnd);
    el.addEventListener('lostpointercapture', onPointerEnd);
    el.addEventListener('dragstart', preventDrag);
    window.addEventListener('resize', onResize);
    // Reduced motion has no loop: a scroll that brings the content under him moves him out of its way.
    if (still) window.addEventListener('scroll', onResize, { passive: true });
    onResize();
    if (!still && box.clientWidth > 0) new Image().src = GRAB_SPRITE; // loaded before the first grab, so he never blanks
    const stopWaving = waveNowAndThen(el);
    return () => {
      stopWaving();
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerEnd);
      el.removeEventListener('pointercancel', onPointerEnd);
      el.removeEventListener('lostpointercapture', onPointerEnd);
      el.removeEventListener('dragstart', preventDrag);
      if (drag && el.hasPointerCapture(drag.pointerId)) el.releasePointerCapture(drag.pointerId);
      delete el.dataset.dragging;
      letGo();
    };
  }, [pathname]);

  if (!shown) return null;
  // These two pages use wider columns than the other attendee pages.
  const width = pathname === '/me/schedule' ? styles.schedule
    : pathname === '/me/hackers' ? styles.directory : styles.standard;

  return (
    <div ref={lane} aria-hidden="true" className={`${styles.lane} ${width}`}>
      <div ref={atom} className={`${styles.atom} ${styles.sprite}`} style={sprite} aria-hidden="true" data-atom="" />
    </div>
  );
}
