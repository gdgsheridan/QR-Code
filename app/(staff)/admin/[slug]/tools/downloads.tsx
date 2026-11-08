'use client';

import { Label } from '@/components/ui/label';

import { useState, type ReactNode } from 'react';
import { adminUrl } from '../api';

// §11 / §13: CSVs are built server-side by toCsv() (I-13); these are plain download links. v0.12.4 (owner's request):
// they moved here from their own Export tab and the Workshops tab.
const ICONS = {
  file: <><path d="M8 3.75h6l4 4v12.5H6V3.75h2Z" strokeLinejoin="round" /><path d="M14 3.75v4h4M9 12h6M9 15.5h6" /></>,
  scan: <><path d="M12 3.5v4m0 9v4M3.5 12h4m9 0h4M6 6l2.8 2.8m6.4 6.4L18 18M18 6l-2.8 2.8m-6.4 6.4L6 18" /><circle cx="12" cy="12" r="4" /></>,
  chart: <path d="M4 19.5h16M6.5 16V10m5.5 6V4.5m5.5 11.5v-8" />,
  people: <><circle cx="9" cy="8.5" r="3" /><path d="M3.75 19.5c.6-3 2.7-4.75 5.25-4.75s4.65 1.75 5.25 4.75M15.5 5.75a3 3 0 0 1 0 5.5M17.25 14.9c1.6.6 2.6 2.1 3 4.6" /></>,
};

function Row({ icon, title, text, href, label, children }: { icon: keyof typeof ICONS; title: string; text: string; href: string; label: string; children?: ReactNode }) {
  return (
    <article className="flex items-center gap-[18px] min-w-0 p-[20px] [border:1px_solid_var(--line)] rounded-lg [background:var(--card)] [transition:border-color_150ms] [&:hover]:border-accent
      max-[600.001px]:grid max-[600.001px]:gap-[14px] max-[600.001px]:p-[16px] max-[600.001px]:[grid-template-columns:42px_minmax(0px,_1fr)]">
      <div aria-hidden="true" className="grid [place-items:center] w-[46px] h-[46px] shrink-0 [border:1px_solid_var(--line)] rounded-lg text-fg max-[600.001px]:w-[42px] max-[600.001px]:h-[42px]">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="w-[23px] h-[23px]">{ICONS[icon]}</svg>
      </div>
      <div className="grid justify-items-start gap-[7px] flex-1 min-w-0 max-[600.001px]:[grid-column:2]">
        <h3 className="m-0 text-[0.98rem] font-bold">{title}</h3>
        <p className="m-0 text-muted-foreground text-[0.83rem] leading-[1.6]">{text}</p>
        {children}
      </div>
      <a href={href} aria-label={label} download
        className="inline-flex items-center justify-center gap-[10px] min-h-[44px] shrink-0 p-[0px_15px] [border:1px_solid_var(--line)] rounded-control [background:var(--card)] text-fg text-[0.82rem] [font-weight:650] no-underline [transition:border-color_150ms] [&:hover]:border-accent
          max-[600.001px]:[grid-column:1_/_-1] max-[600.001px]:w-full">
        Download <span aria-hidden="true" className="text-[1rem]">↓</span>
      </a>
    </article>
  );
}

export function Downloads({ slug }: { slug: string }) {
  const [includeVoided, setIncludeVoided] = useState(false);
  const link = (kind: string, query = '') => adminUrl(slug, `/export/${kind}${query}`);
  return (
    <section aria-labelledby="downloads" className="grid gap-[14px] max-w-[900px] min-w-0 [&_a:focus-visible]:[outline:2px_solid_var(--accent)] [&_a:focus-visible]:[outline-offset:3px] [&_input:focus-visible]:[outline:2px_solid_var(--accent)] [&_input:focus-visible]:[outline-offset:3px]">
      <div>
        <h2 id="downloads" className="m-0 text-[1.08rem] tracking-[-0.02em]">Download CSV</h2>
        <p className="copy m-[7px_0px_0px] text-muted-foreground text-[0.88rem] leading-[1.65]">
          UTF-8 files that open in Excel. Times are in UTC and the event’s timezone, as applicable.
        </p>
      </div>
      <Row icon="file" title="Participants" text="Participant records for attendance tracking and event administration." href={link('participants.csv')} label="Download participants CSV" />
      <Row icon="scan" title="Scans" text="Every checkpoint scan, with removed (voided) scans if you tick the box." href={link('scans.csv', includeVoided ? '?includeVoided=1' : '')} label="Download scans CSV">
        <Label className="inline-flex items-center gap-[9px] mt-[5px] min-h-[24px] text-fg text-[0.82rem] font-medium cursor-pointer">
          <input type="checkbox" className="w-[16px] h-[16px] m-0 [accent-color:var(--accent)] cursor-pointer" checked={includeVoided} onChange={(e) => setIncludeVoided(e.target.checked)} />
          <span>Include voided scans</span>
        </Label>
      </Row>
      <Row icon="chart" title="Checkpoint summary" text="Scans per checkpoint, for event reporting." href={link('summary.csv')} label="Download checkpoint summary CSV" />
      <Row icon="people" title="Workshop attendance" text="Who checked in to each workshop, and when. Names and times, no emails." href={link('workshops.csv')} label="Download workshop attendance CSV" />
    </section>
  );
}
