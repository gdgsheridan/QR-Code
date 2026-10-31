import type { ReactNode } from 'react';

// The hacker menu's icons: one 24-unit grid, 1.75 stroke, decorative (the text names each item).
function Icon({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const QrIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <path d="M14 14h3v3M21 14v.01M14 21h3M21 18v3h-1M17 17h.01" />
  </Icon>
);

export const ProfileIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </Icon>
);

export const TeamIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.5A6.5 6.5 0 0 1 21.5 20" />
  </Icon>
);

// Hackers: a directory card (Team keeps the two people).
export const HackersIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10.5" r="2.5" />
    <path d="M5.5 16.5a3.5 3.5 0 0 1 7 0M15 9.5h3M15 13h3" />
  </Icon>
);

export const ScheduleIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <rect x="3" y="4.5" width="18" height="16.5" rx="2" />
    <path d="M3 9.5h18M8 2.5v4M16 2.5v4M7.5 13.5h3M7.5 17h6" />
  </Icon>
);

export const EmergencyIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M12 21s-7.5-4.6-7.5-11A4.5 4.5 0 0 1 12 6.6 4.5 4.5 0 0 1 19.5 10c0 6.4-7.5 11-7.5 11Z" />
    <path d="M12 10v5M9.5 12.5h5" />
  </Icon>
);

export const ChevronIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="m9 5 7 7-7 7" />
  </Icon>
);
