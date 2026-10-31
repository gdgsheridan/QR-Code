import { BrandMark } from '@/components/brand-mark';

import { Entrance } from '@/components/motion';
import type { Metadata } from 'next';
import Link from 'next/link';

// Its own tab title for an unknown URL (a menu page's notFound() keeps that page's title).
export const metadata: Metadata = { title: 'Page not found · Datathon', robots: { index: false, follow: false } };

// Next's built-in 404 paints its own white/black body; this one keeps the app's theme.
export default function NotFound() {
  return (
    <Entrance><main style={{ maxWidth: 420, margin: '0 auto', padding: '32px 16px' }}>
      <BrandMark />
      <h1>Page not found</h1>
      <p className="copy">This link doesn’t go anywhere. Check it, or start again from your menu.</p>
      <Link className="inline-flex min-h-11 items-center underline" href="/me">My menu</Link>
    </main></Entrance>
  );
}
