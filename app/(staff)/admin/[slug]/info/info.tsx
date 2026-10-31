'use client';

import { SectionLabel } from '@/components/section-label';
import { Alert } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

import { useCallback, useState } from 'react';
import { toLocalInput, zonedToUtc } from '@/lib/domain/event-time';
import { adminUrl, errorText, useApi, useLoad } from '../api';

interface EventInfo {
  /** v0.9 (F13): an instant from the API; edited as a datetime-local in the event timezone. */
  rsvpDeadline: string | null;
  /** v0.11.28: the date shown to invitees, which can be earlier than the deadline. */
  rsvpReplyBy: string | null;
  timezone: string;
}

// SPEC §11 Info: the RSVP deadline, edited in the event timezone (F13).
export function Info({ slug }: { slug: string }) {
  const api = useApi();
  const [info, setInfo] = useState<EventInfo | null>(null);
  const [deadline, setDeadline] = useState('');
  const [replyBy, setReplyBy] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await api<EventInfo>(adminUrl(slug, '/event'));
    if (r.ok) {
      setInfo({ rsvpDeadline: r.data.rsvpDeadline, rsvpReplyBy: r.data.rsvpReplyBy, timezone: r.data.timezone });
      setDeadline(r.data.rsvpDeadline ? toLocalInput(r.data.rsvpDeadline, r.data.timezone) : '');
      setReplyBy(r.data.rsvpReplyBy ? toLocalInput(r.data.rsvpReplyBy, r.data.timezone) : '');
    } else setError(errorText(r));
  }, [api, slug]);

  useLoad(load);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!info) return;
    setBusy(true);
    setMessage(null);
    const body = {
      rsvpDeadline: deadline ? zonedToUtc(deadline, info.timezone) : null,
      rsvpReplyBy: replyBy ? zonedToUtc(replyBy, info.timezone) : null,
    };
    const r = await api<EventInfo>(adminUrl(slug, '/event'), { method: 'PATCH', body });
    setBusy(false);
    if (r.ok) {
      setError(null);
      setMessage('✓ Saved.');
    } else setError(r.status === 400 ? 'Choose future times, with Reply by no later than RSVPs close, or leave them empty.' : errorText(r));
  }

  return (
    <div className="grid gap-[24px] min-w-0 pb-[32px] [&_button:focus-visible]:[outline:2px_solid_var(--accent)]

          [&_button:focus-visible]:[outline-offset:3px]">
      <header className="p-[8px_0px] [&_h1]:m-0 [&_h1]:text-[clamp(1.8rem,_3vw,_2.3rem)] [&_h1]:tracking-[-0.045em]">
        <div>
          <SectionLabel>EVENT MANAGEMENT</SectionLabel>
          <h1>Event info</h1>
          <p className="copy max-w-[680px] m-[7px_0px_0px] text-muted-foreground text-[0.9rem] leading-[1.65]">
            Set the RSVP deadline for this event.
          </p>
        </div>
      </header>
      {error && (
        <Alert className="flex items-start gap-[12px] m-[0px_0px_14px] p-[15px_17px] [border-width:1px] [border-style:solid]

          [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]

          [border-left-color:var(--line)] rounded-md [background:var(--card)] text-fg text-[13px]

          leading-[1.65] [overflow-wrap:anywhere]

          [&&]:[border-color:color-mix(in_srgb,_var(--bad,_#f87171)_40%,_var(--line))]

          [&&]:[background:color-mix(in_srgb,_#f87171_6%,_var(--card))]" asChild><p  role="alert">
          ✕ {error}
        </p></Alert>
      )}
      {message && (
        <Alert className="flex items-start gap-[12px] m-[0px_0px_14px] p-[15px_17px] [border-width:1px] [border-style:solid]

          [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]

          [border-left-color:var(--line)] rounded-md [background:var(--card)] text-fg text-[13px]

          leading-[1.65] [overflow-wrap:anywhere]

          [&&]:[border-color:color-mix(in_srgb,_var(--ok,_#4ade80)_40%,_var(--line))]

          [&&]:[background:color-mix(in_srgb,_#4ade80_6%,_var(--card))]" asChild role="status"><p  role="status">
          {message}
        </p></Alert>
      )}
      {!info ? (
        <p className="tw-admin-muted text-muted-foreground text-[12px] leading-[1.7]">Loading event information…</p>
      ) : (
        <form className="grid gap-[20px] max-w-[1100px]" onSubmit={(e) => void save(e)}>
          <section className="grid gap-[22px] min-w-0 p-[24px] [background:var(--card)] [border-width:1px] [border-style:solid]

          [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]

          [border-left-color:var(--line)] rounded-ticket max-[600.001px]:p-[18px] [&_.tw-admin-field]:grid

          [&_.tw-admin-field]:gap-[10px] [&_.tw-admin-field]:text-[0.84rem] [&_.tw-admin-field]:[font-weight:650]">
            <div className="flex items-start gap-[14px] [&_h2]:m-0 [&_h2]:text-[1.08rem] [&_h2]:tracking-[-0.02em]">
              <div>
                <h2>RSVP deadline</h2>
                <p className="copy max-w-[680px] m-[7px_0px_0px] text-muted-foreground text-[0.9rem] leading-[1.65]">When invitees are asked to reply, and when invitations really close.</p>
              </div>
            </div>
            <Label className="tw-admin-field grid min-w-[140px] flex-[1_1_180px] gap-2 text-sm text-muted-foreground">
              Reply by ({info.timezone})
              <Input className="tw-admin-input w-full" type="datetime-local" value={replyBy} onChange={(e) => setReplyBy(e.target.value)} />
              <span className="text-muted-foreground text-[0.78rem] font-normal leading-[1.5]">
                The date in the RSVP email and on the RSVP page. Invitees get a reminder at 10:00 that day and the two days before. Answers still count until RSVPs close. Leave it empty to show the close date.
              </span>
            </Label>
            <Label className="tw-admin-field grid min-w-[140px] flex-[1_1_180px] gap-2 text-sm text-muted-foreground">
              RSVPs close ({info.timezone})
              <Input className="tw-admin-input w-full" type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
              <span className="text-muted-foreground text-[0.78rem] font-normal leading-[1.5]">
                After this, Yes is refused and no reply counts as a no. Someone invited late gets 48 hours. Leave it empty for no deadline.
              </span>
            </Label>
          </section>
          <div className="flex items-center justify-between gap-[20px] max-w-[1100px] p-[4px_0px] max-[600.001px]:items-stretch

          max-[600.001px]:flex-col">
            <p className="copy max-w-[480px] m-0 text-muted-foreground text-[0.8rem] leading-[1.6]">Save your changes to update the RSVP deadline.</p>
            <div className="flex items-center gap-[10px] max-[600.001px]:w-full max-[600.001px]:[&_button]:flex-1">
              <Button type="submit" variant="secondary" className="shrink-0 max-[600px]:w-full" disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
