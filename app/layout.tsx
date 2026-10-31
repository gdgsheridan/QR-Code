import type { Metadata, Viewport } from 'next';
import { Fira_Code } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';
import { SiteBackground } from '@/components/site-background';
import { MotionProvider } from '@/components/motion';

// Self-hosted by next/font, so the CSP's font-src 'self' still holds.
const firaCode = Fira_Code({ subsets: ['latin'], variable: '--font-fira-code' });

export const metadata: Metadata = {
  title: 'Datathon',
  description: 'Event passes and check-in',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#091642', // the visible ground (constellation under the veil), sampled
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={firaCode.variable}>
      <body><SiteBackground /><MotionProvider>{children}</MotionProvider></body>
    </html>
  );
}
