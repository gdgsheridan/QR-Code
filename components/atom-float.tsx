'use client';

import Image from 'next/image';
import { usePathname } from 'next/navigation';
import styles from './atom-float.module.css';

export function AtomFloat() {
  const pathname = usePathname();
  const attendee = pathname === '/me' || pathname.startsWith('/me/');
  if (!attendee && !['/rsvp', '/login', '/set-password', '/auth/confirm'].includes(pathname)) return null;

  // These two pages use wider columns than the other attendee pages.
  const width = pathname === '/me/schedule' ? styles.schedule
    : pathname === '/me/hackers' ? styles.directory : styles.standard;

  return (
    <Image
      className={`${styles.atom} ${width}`}
      src="/atom.webp"
      width={640}
      height={640}
      alt=""
      aria-hidden="true"
      unoptimized
      data-atom=""
    />
  );
}
