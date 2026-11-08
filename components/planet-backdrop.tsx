'use client';

import { usePathname } from 'next/navigation';
import { isAttendeePage } from './attendee-pages';
import styles from './planet-backdrop.module.css';

// Owner's request: the ringed planet from the datathon art (its star and dots removed) sits behind the attendee pages,
// partly off the window's corner. Its surface bands sway through a 12-frame sprite in CSS; reduced motion: frame 1.
export function PlanetBackdrop() {
  const pathname = usePathname();
  if (!isAttendeePage(pathname)) return null;
  return <div aria-hidden="true" data-planet="" className={styles.planet}
    style={{ backgroundImage: 'url(/planet-sprite.webp)' }} />;
}
