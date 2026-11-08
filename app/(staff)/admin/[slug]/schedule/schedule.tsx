'use client';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useCallback, useDeferredValue, useEffect, useState } from 'react';
import { ScheduleContent } from '@/app/me/schedule/content';
import { adminUrl, errorText, useApi, useLoad } from '../api';
import { PageHeader } from '../page-header';

const MAX = 5000; // events.schedule check (§5.4)
interface EventInfo { schedule: string; timezone: string; startsAt: string }

// SPEC §11 Schedule (v0.12.6, owner's request): edit the hackers' schedule text with a live preview of /me/schedule.
export function ScheduleEditor({ slug }: { slug: string }) {
  const api = useApi();
  const [info, setInfo] = useState<EventInfo | null>(null);
  const [base, setBase] = useState(''); // what the server had when we loaded or last saved
  const [text, setText] = useState('');
  const [conflict, setConflict] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now] = useState(() => new Date());
  const preview = useDeferredValue(text);
  const dirty = info !== null && text !== base;

  const load = useCallback(async () => {
    const r = await api<EventInfo>(adminUrl(slug, '/event'));
    if (r.ok) {
      setInfo(r.data);
      setBase(r.data.schedule);
      setText(r.data.schedule);
    } else setError(errorText(r));
  }, [api, slug]);
  useLoad(load);

  // Unsaved edits survive an accidental tab close or reload prompt.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function save(force = false) {
    setBusy(true);
    setMessage(null);
    setError(null);
    if (!force) {
      // Someone else (or a direct database edit) may have saved since we loaded: don't overwrite it silently.
      const latest = await api<EventInfo>(adminUrl(slug, '/event'));
      if (!latest.ok) { setBusy(false); setError(errorText(latest)); return; }
      if (latest.data.schedule !== base && latest.data.schedule !== text) { setBusy(false); setConflict(latest.data.schedule); return; }
    }
    const r = await api<EventInfo>(adminUrl(slug, '/event'), { method: 'PATCH', body: { schedule: text } });
    setBusy(false);
    if (r.ok) {
      setBase(text);
      setConflict(null);
      setMessage('✓ Saved. Hackers see the new schedule now.');
    } else setError(r.status === 400 ? `The schedule can be at most ${MAX.toLocaleString('en-CA')} characters.` : errorText(r));
  }

  function loadTheirs() {
    if (conflict === null) return;
    setText(conflict);
    setBase(conflict);
    setConflict(null);
    setMessage('Loaded the latest saved schedule. Your edits were discarded.');
  }

  return (
    <div className="grid gap-[24px] min-w-0 pb-[32px]">
      <PageHeader title="Schedule" description="What hackers see on their Schedule page. Edit the text and check the preview, then save.">
        {info && (
          <>
            <Button type="button" variant="outline" className="min-h-[44px]" disabled={!dirty || busy} onClick={() => { setText(base); setMessage(null); }}>
              Undo changes
            </Button>
            <Button type="button" className="min-h-[44px]" disabled={!dirty || busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save schedule'}
            </Button>
          </>
        )}
      </PageHeader>
      {error && <Alert variant="destructive">✕ {error}</Alert>}
      {conflict !== null && (
        <Alert variant="destructive" className="grid gap-[12px]">
          <p className="m-0">✕ Someone else saved the schedule after you opened this page. Saving yours would replace their changes.</p>
          <div className="flex flex-wrap gap-[8px]">
            <Button type="button" variant="outline" className="min-h-[44px]" onClick={loadTheirs}>Load theirs (discard mine)</Button>
            <Button type="button" variant="outline" className="min-h-[44px]" disabled={busy} onClick={() => void save(true)}>Save mine anyway</Button>
          </div>
        </Alert>
      )}
      {message && <Alert role="status">{message}</Alert>}
      {!info ? (
        !error && <p className="text-muted-foreground text-[12px] leading-[1.7]">Loading the schedule…</p>
      ) : (
        <div className="grid gap-[24px] items-start min-[1280px]:grid-cols-[minmax(380px,0.8fr)_minmax(0,1.2fr)]">
          <section className="grid gap-[12px] min-w-0 min-[1280px]:sticky min-[1280px]:top-[80px]">
            <Label htmlFor="schedule-text" className="flex items-baseline justify-between gap-[12px] text-[0.84rem] font-semibold">
              Schedule text
              <span className="text-muted-foreground text-[0.78rem] font-normal tabular-nums">
                {dirty ? 'Unsaved changes · ' : ''}{text.length.toLocaleString('en-CA')} / {MAX.toLocaleString('en-CA')}
              </span>
            </Label>
            <Textarea id="schedule-text" value={text} maxLength={MAX} wrap="off" spellCheck={false}
              onChange={(e) => { setText(e.target.value); setMessage(null); }}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); if (dirty && !busy) void save(); } }}
              className="[field-sizing:fixed] h-[min(70vh,860px)] text-[13px] max-[600px]:text-[16px] leading-[1.6] whitespace-pre overflow-auto" />
            <ul className="m-0 pl-[18px] grid gap-[4px] text-muted-foreground text-[0.8rem] leading-[1.55]">
              <li>A line like <code>Saturday, Nov 7</code> starts a day.</li>
              <li>One event per line: <code>9:00 PM-10:00 PM | Title | Place</code>. The end time and place are optional.</li>
              <li>The title picks the column: Workshop or Talk → Workshops; Lunch, Dinner, Breakfast or Snack → Food; Sponsor → Sponsors; Hacking, Devpost, Demos or Judging → Hacking; anything else → Activities.</li>
              <li>Press Ctrl+S (⌘S on a Mac) to save.</li>
            </ul>
          </section>
          <section aria-label="Preview" className="grid gap-[12px] min-w-0">
            <h2 className="m-0! text-[0.84rem]! font-semibold">Preview</h2>
            <ScheduleContent schedule={preview} now={now} timezone={info.timezone} eventStartsAt={info.startsAt} />
          </section>
        </div>
      )}
    </div>
  );
}
