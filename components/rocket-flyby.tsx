'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import styles from './rocket-flyby.module.css';

// The asset's nose, measured from the fuselage's principal axis (flame toward nose): 46.08° up and to the right, i.e.
// -46.08° in screen degrees (y down). Each flight turns the image by (heading - NOSE) so the nose leads.
const NOSE = -46.08431892835742;
const SPEED = 45; // px/s
const motionQuery = '(prefers-reduced-motion: reduce)';
const motionAllowed = () => !window.matchMedia(motionQuery).matches;
const serverMotionAllowed = () => false;
const subscribeMotion = (notify: () => void) => {
  const media = window.matchMedia(motionQuery);
  media.addEventListener('change', notify);
  return () => media.removeEventListener('change', notify);
};

export function RocketFlyby() {
  const pathname = usePathname();
  const attendee = pathname === '/me' || pathname.startsWith('/me/');
  const shown = attendee || ['/rsvp', '/login', '/set-password', '/auth/confirm'].includes(pathname);
  const animate = useSyncExternalStore(subscribeMotion, motionAllowed, serverMotionAllowed);
  const rocket = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = rocket.current;
    if (!el || !shown || !animate) return;
    let frame = 0;
    let last = 0;
    // The rocket's centre, velocity and turn; r: half its diagonal, so at any turn it's fully off-screen past r.
    let cx = 0;
    let cy = 0;
    let vx = 0;
    let vy = 0;
    let turn = 0;
    let r = 0;
    let width = 0;
    let height = 0;
    let viewportWidth = 0;
    let viewportHeight = 0;
    const measure = () => {
      width = el.offsetWidth;
      height = el.offsetHeight;
      r = Math.hypot(width, height) / 2;
      viewportWidth = window.innerWidth;
      viewportHeight = window.innerHeight;
    };
    const draw = () => {
      el.style.transform = `translate3d(${cx - width / 2}px, ${cy - height / 2}px, 0) rotate(${turn}deg)`;
    };
    // v0.11.30 (owner's request): a random heading and a random point on screen; it enters from just off the edge
    // behind it and flies straight through that point until it's off the far side. Once per page load.
    const launch = () => {
      measure();
      const heading = Math.random() * 2 * Math.PI; // screen radians (y down)
      vx = SPEED * Math.cos(heading);
      vy = SPEED * Math.sin(heading);
      turn = heading * 180 / Math.PI - NOSE;
      const px = viewportWidth * (0.15 + Math.random() * 0.7);
      const py = viewportHeight * (0.15 + Math.random() * 0.7);
      // Back along the line from that point to the first spot fully off-screen.
      const backX = vx > 0 ? (px + r) / vx : vx < 0 ? (viewportWidth + r - px) / -vx : Infinity;
      const backY = vy > 0 ? (py + r) / vy : vy < 0 ? (viewportHeight + r - py) / -vy : Infinity;
      const back = Math.min(backX, backY);
      cx = px - vx * back;
      cy = py - vy * back;
      draw();
      last = performance.now();
      frame = requestAnimationFrame(tick);
    };
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      cx += vx * dt;
      cy += vy * dt;
      draw();
      // One flight per page load (owner's request): once it's off the far side it stays gone.
      const gone = vx > 0 && cx > viewportWidth + r || vx < 0 && cx < -r || vy > 0 && cy > viewportHeight + r || vy < 0 && cy < -r;
      if (gone) el.style.visibility = 'hidden';
      else frame = requestAnimationFrame(tick);
    };
    launch();
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', measure);
    };
  }, [shown, animate]); // Attendee-to-attendee navigation preserves the current flight.

  if (!shown || !animate) return null;
  // The flame flickers through an 8-frame sprite (CSS); the flight itself is the transform set above.
  return <div ref={rocket} aria-hidden="true" data-rocket="" className={styles.rocket}
    style={{ backgroundImage: 'url(/rocket-sprite.webp)' }} />;
}
