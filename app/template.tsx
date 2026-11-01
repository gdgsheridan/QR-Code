import type { ReactNode } from 'react';
import { PageTransition } from '@/components/page-transition';

// v0.11.29: templates remount on every navigation, so each new page plays the transition (SPEC §15 Look).
export default function Template({ children }: { children: ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
