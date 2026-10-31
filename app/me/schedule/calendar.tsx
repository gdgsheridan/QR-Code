'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { NativeDialog } from '@/components/ui/native-dialog';
import { scheduleTimeline, type ScheduleCategory, type ScheduleSection, type TimelineSlot } from '@/lib/domain/schedule';

// Colours sampled from the Hacker Package poster. Red and blue are the next Google shade down from the poster's
// #EA4335 / #4285F4 so white small text meets WCAG AA (SPEC §15).
const categories: { id: ScheduleCategory; label: string; colour: string; classes: string }[] = [
  { id: 'hacking', label: 'Hacking', colour: '#d93025', classes: 'bg-[#d93025] text-white border-[#b3261e]' },
  { id: 'activities', label: 'Activities', colour: '#1a73e8', classes: 'bg-[#1a73e8] text-white border-[#1967d2]' },
  { id: 'workshops', label: 'Workshops', colour: '#fbbc04', classes: 'bg-[#fbbc04] text-[#3b2f00] border-[#f29900]' },
  { id: 'food', label: 'Food', colour: '#34a853', classes: 'bg-[#e6f4ea] text-[#0d652d] border-[#34a853]' },
  { id: 'sponsors', label: 'Sponsors', colour: '#1a3a7a', classes: 'bg-[#1a3a7a] text-white border-[#122a5c]' },
];
const HOUR_HEIGHT = 64;
const GRID_MIN_WIDTH = 240; // the columns fit a phone; only narrower screens scroll inside the grid
const DEPTH_INSET = 12;
const NUDGE = 20;
const theme = [
  'bg-[var(--surface)] p-3 [--time-column:44px] lg:[--time-column:64px]',
  '[--cal-grid:var(--surface)] [--cal-axis:var(--surface)] [--cal-line:var(--edge)] [--cal-ink:var(--fg)] [--cal-muted:var(--ink-soft)] [--cal-label:var(--ink-soft)] [--cal-chip:var(--raised)] [--cal-chip-ink:var(--text-accent)]',
].join(' ');
const position = 'top-[calc((var(--minute)-var(--range-start))*var(--hour-height)/60)]';
const focus = 'focus-visible:outline-2 focus-visible:outline-[#174ea6] focus-visible:outline-offset-2';
const details = 'mt-0.5 text-[11px] leading-[1.3]';
// Poster day headers alternate light and dark blue.
const headerStyles = ['border-[#c6d9f8] bg-[#d2e3fc] text-[#174ea6]', 'border-[#174ea6] bg-[#174ea6] text-[#d2e3fc]'];
function dayHeading(label: string | null, index: number) {
  const [line = '', ...notes] = (label ?? '').split('\n');
  const match = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s*(.*)$/i.exec(line);
  const weekday = match?.[1]?.slice(0, 3) ?? '';
  const date = match?.[2] || line || `Day ${index + 1}`;
  return { weekday, date, notes, button: [weekday, date].filter(Boolean).join(' ') };
}
function hourLabel(minute: number) {
  const hour = Math.floor(minute / 60) % 24;
  return `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}`;
}
// "1:15 PM" + "2:00 PM" → "1:15–2 PM" for narrow cards; anything else is shown as typed.
function compactTime(start: string, end: string | null) {
  const parse = (time: string) => /^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?$/i.exec(time.trim());
  const [a, b] = [parse(start), end ? parse(end) : null];
  if (!a || (end && !b)) return end ? `${start}–${end}` : start;
  const short = (m: RegExpExecArray) => `${m[1]}${m[2] && m[2] !== '00' ? `:${m[2]}` : ''}`;
  const suffix = (m: RegExpExecArray) => ` ${m[3]!.toUpperCase()}M`;
  if (!b) return short(a) + suffix(a);
  return `${short(a)}${a[3]!.toLowerCase() === b[3]!.toLowerCase() ? '' : suffix(a)}–${short(b)}${suffix(b)}`;
}
// Workshops are yellow, so "Workshop:" / "Talk:" can go when a card is narrow.
const REDUNDANT_PREFIX = /^((?:Workshop|Talk)\s*:\s*)(.+)$/i;
// "Snack Cart, by Accenture": a narrow card shows just "Snack Cart" (the dialog has the rest).
const SPONSOR_SUFFIX = /^(.+?)(,\s*by\s+.+)$/i;
const narrowHidden = '@max-[8.5rem]:hidden';
/** The title with the parts a narrow card drops wrapped so they hide; the accessible text stays whole. */
function cardTitle(title: string, category: ScheduleCategory): ReactNode {
  const prefix = category === 'workshops' ? REDUNDANT_PREFIX.exec(title) : null;
  const rest = prefix ? prefix[2]! : title;
  const suffix = SPONSOR_SUFFIX.exec(rest);
  return <>{prefix && <span className={narrowHidden}>{prefix[1]}</span>}{suffix ? <>{suffix[1]}<span className={narrowHidden}>{suffix[2]}</span></> : rest}</>;
}
function duration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  return [hours && `${hours} h`, minutes % 60 && `${minutes % 60} min`].filter(Boolean).join(' ');
}
const STATE_LABEL = { past: 'Finished', current: 'Happening now', upcoming: 'Upcoming' } as const;
type Selected = { slot: TimelineSlot; day: string };

// The poster is static; here each event opens a dialog with everything about it.
function EventDialog({ selected, onClose }: { selected: Selected | null; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (selected && element && !element.open) element.showModal();
  }, [selected]);
  const slot = selected?.slot;
  const category = slot && categories.find(c => c.id === slot.category)!;
  const [title = '', ...subtitle] = slot?.title.split(' — ') ?? [];
  // `close` fires after a task: if the dialog was reopened meanwhile (Escape, then Enter), that late event must not clear it.
  return <NativeDialog ref={dialog} aria-labelledby="schedule-event-title" onClose={() => { if (!dialog.current?.open) onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}
    className="w-[min(28rem,calc(100vw-32px))] overflow-hidden p-0">
    {slot && category && <div>
      <div className={`flex items-center justify-between gap-3 border-0 border-b-[1.5px] border-solid px-5 py-3 ${category.classes}`}>
        <span className="text-sm font-bold">{category.label}</span>
        <span className="text-sm font-medium">{STATE_LABEL[slot.state]}</span>
      </div>
      <div className="grid gap-4 p-5">
        <div className="grid gap-1">
          <h2 id="schedule-event-title" className="m-0 text-xl leading-[1.25] font-bold text-fg">{title}</h2>
          {subtitle.length > 0 && <p className="m-0 text-[15px] text-muted-foreground">{subtitle.join(' — ')}</p>}
        </div>
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[15px]">
          <dt className="font-bold text-muted-foreground">When</dt>
          <dd className="m-0">{selected.day && <>{selected.day}<br /></>}{slot.start}{slot.end ? ` to ${slot.end}` : ''} <span className="text-muted-foreground">({duration(slot.endMinute - slot.startMinute)}{slot.end ? '' : ', end not posted'})</span></dd>
          {slot.place && <><dt className="font-bold text-muted-foreground">Where</dt><dd className="m-0 font-bold">{slot.place}</dd></>}
        </dl>
        <form method="dialog" className="m-0">
          <Button type="submit" autoFocus className="w-full">Close</Button>
        </form>
      </div>
    </div>}
  </NativeDialog>;
}
function CalendarScroll({ children, label }: { children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setOverflowing(element.scrollWidth > element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <>
    {overflowing && <p className="mt-0 mb-2 text-xs text-[var(--cal-muted)] lg:hidden">Scroll across for overlapping events →</p>}
    <div ref={ref} className={`max-w-full overflow-auto rounded-b-lg border border-t-0 border-[var(--cal-line)] bg-[var(--cal-grid)] ${focus}`} tabIndex={0} role="region" aria-label={label}>{children}</div>
  </>;
}

export function ScheduleCalendar({ sections, initialNow, timezone, eventStartsAt }: { sections: ScheduleSection[]; initialNow: string; timezone: string; eventStartsAt: string }) {
  const [open, setOpen] = useState<Selected | null>(null);
  const [now, setNow] = useState(() => new Date(initialNow));
  useEffect(() => {
    const tick = () => setNow(new Date());
    const initial = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 60_000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, []);
  const days = scheduleTimeline(sections, now, timezone, eventStartsAt);
  const liveDay = days.findIndex(day => day.nowMinute !== null);
  const activeDay = liveDay >= 0 ? liveDay : days.findIndex(day => day.isToday);
  // A manual choice lasts until the current event day changes (including its overnight tail).
  const [choice, setChoice] = useState<{ index: number; activeDay: number } | null>(null);
  const selected = choice?.activeDay === activeDay ? choice.index : Math.max(0, activeDay);
  const headings = days.map((day, i) => dayHeading(day.label, i));
  const populated = days.filter(d => d.slots.length);
  const start = Math.min(...populated.map(d => d.startMinute));
  const end = Math.max(...populated.map(d => d.endMinute));
  const hours = Array.from({ length: (end - start) / 60 + 1 }, (_, i) => start + i * 60);
  // Busier days get wider columns (Saturday's 23 events against Sunday's 6 is about 2 : 1).
  const dayColumns = days.map(day => `minmax(0, ${Math.sqrt(Math.max(1, day.slots.length)).toFixed(2)}fr)`).join(' ');
  const nowLabel = `now ${new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' }).format(now)}`;
  // The site's dark surface and Fira Code at every width; event cards keep the Hacker Package poster colours.
  return <div className={`min-w-0 rounded-md text-[var(--cal-ink)] lg:p-6 ${theme}`} style={{ '--hour-height': `${HOUR_HEIGHT}px` } as CSSProperties}>
    <div className="mb-4 flex flex-wrap gap-2 lg:hidden" aria-label="Schedule day">
      {headings.map((heading, i) => days[i]!.slots.length > 0 && <button key={i} type="button" aria-pressed={selected === i} onClick={() => setChoice({ index: i, activeDay })}
        className={`min-h-11 cursor-pointer rounded-md border border-[var(--cal-line)] bg-[var(--cal-chip)] px-4 py-2 font-[inherit] font-medium text-[var(--cal-chip-ink)] aria-pressed:border-[#174ea6] aria-pressed:bg-[#174ea6] aria-pressed:text-white ${focus}`}>{heading.button}</button>)}
    </div>
    <div className="grid gap-4 lg:grid-cols-[var(--day-columns)] lg:items-start lg:gap-3" style={{ '--day-columns': dayColumns } as CSSProperties}>
      {days.map((day, i) => {
        const heading = headings[i]!;
        if (!day.slots.length && !day.unscheduled.length) return <p key={i} className="whitespace-pre-line [overflow-wrap:anywhere]">{day.label}</p>;
        return <section key={i} className={`min-w-0 lg:block ${selected === i ? 'block' : 'hidden'}`} aria-labelledby={`schedule-day-${i}`}>
          <h2 id={`schedule-day-${i}`} className={`mt-0 mb-0 flex min-h-16 flex-col items-center justify-center gap-0 rounded-t-lg border text-center lg:ml-[var(--time-column)] ${headerStyles[i % 2]}`}>
            {heading.weekday && <span className="text-[13px] font-medium tracking-[.08em] uppercase">{heading.weekday}</span>}<strong className="text-[26px] leading-[1.1] font-bold uppercase">{heading.date}</strong>
          </h2>
          {heading.notes.map((note, n) => <p key={n} className="whitespace-pre-line [overflow-wrap:anywhere]">{note}</p>)}
          {day.unscheduled.map((slot, n) => <p key={n}>{slot.start} · {slot.title}{slot.place && ` · ${slot.place}`}</p>)}
          {day.slots.length > 0 && <CalendarScroll label={`${heading.button} calendar`}>
            {/* Share the desktop origin so hours align, but stop each grid at its own end. */}
            <div className="relative mt-3 h-[calc((var(--range-end)-var(--range-start))*var(--hour-height)/60+24px)] [--range-end:var(--day-end)] [--range-start:var(--day-start)] lg:[--range-start:var(--common-start)]"
              style={{ '--day-start': day.startMinute, '--day-end': day.endMinute, '--common-start': start, minWidth: `calc(var(--time-column) + ${GRID_MIN_WIDTH}px)` } as CSSProperties}>
              <div aria-hidden="true" className="pointer-events-none absolute inset-0">
                <div className="absolute -top-3 bottom-0 left-0 w-[var(--time-column)] border-r border-[var(--cal-line)] bg-[var(--cal-axis)]" />
                {hours.filter(hour => hour <= day.endMinute).map(hour => <div key={hour} className={`absolute right-0 left-0 h-px ${position} ${hour < day.startMinute ? 'hidden lg:block' : ''}`} style={{ '--minute': hour } as CSSProperties}>
                  <span className="absolute right-0 left-[var(--time-column)] h-px bg-[var(--cal-line)]" />
                  <span className="absolute top-1/2 left-0 w-[var(--time-column)] -translate-y-1/2 text-center text-[11px] leading-5 font-bold whitespace-nowrap text-[var(--cal-label)] tabular-nums lg:text-[13px]">{hourLabel(hour)}</span>
                </div>)}
              </div>
              <ol className="absolute isolate inset-[0_4px_24px_calc(var(--time-column)+4px)] m-0 list-none p-0" aria-label={day.label ?? heading.button}>
                {day.slots.map((slot, j) => {
                  const [title = '', ...subtitle] = slot.title.split(' — ');
                  const time = `${slot.start}${slot.end ? ` to ${slot.end}` : ''}`;
                  const category = categories.find(c => c.id === slot.category)!;
                  const length = slot.endMinute - slot.topMinute;
                  const short = length < 60 || (length < 90 && slot.width < 0.3);
                  const inset = slot.depth * DEPTH_INSET;
                  const nudge = slot.nudged ? NUDGE : 0;
                  const colour = slot.state === 'past' ? 'bg-[#f1f3f4] text-[#5f6368] border-[#dadce0] border-l-[3px] border-l-[var(--category)]' : category.classes;
                  return <li key={j} data-state={slot.state}
                    lang="en" className={`group absolute overflow-hidden rounded-[5px] border-[1.5px] text-xs leading-[1.25] hyphens-auto [overflow-wrap:anywhere] hover:brightness-[1.04] hover:outline-2 hover:outline-[#174ea6]/60 hover:outline-offset-1 has-[button:focus-visible]:outline-2 has-[button:focus-visible]:outline-[#174ea6] has-[button:focus-visible]:outline-offset-2 ${position} ${colour} @container ${slot.state === 'current' ? 'ring-2 ring-[#174ea6] ring-offset-1 ring-offset-[var(--cal-grid)]' : ''} ${inset || nudge ? 'shadow-[0_0_0_2px_var(--cal-grid)]' : ''}`}
                    style={{ '--minute': slot.topMinute, '--category': category.colour,
                      marginTop: nudge + 1, zIndex: slot.layer + 1,
                      height: length * HOUR_HEIGHT / 60 - 2 - nudge,
                      left: `calc(${slot.left * 100}% + ${inset}px)`, width: `calc(${slot.width * 100}% - ${inset + 3}px)` } as CSSProperties}>
                    <button type="button" aria-haspopup="dialog" onClick={() => setOpen({ slot, day: day.label ?? heading.button })}
                      className="flex size-full cursor-pointer flex-col justify-start overflow-hidden border-0 bg-transparent px-2 py-1 text-left font-[inherit] text-inherit outline-none @max-[8.5rem]:px-1.5">
                      <span className="sr-only">{category.label}. {slot.state === 'current' ? 'In progress' : slot.state}. </span>
                      <strong className={`text-[13px] leading-[1.25] font-bold @max-[8.5rem]:text-xs ${length <= 30 ? 'block truncate' : 'line-clamp-2'}`}>
                        {cardTitle(title, slot.category)}
                      </strong>
                      {subtitle.length > 0 && <span className={`${details} block ${short ? 'sr-only' : 'line-clamp-1 @max-[8.5rem]:hidden'}`}>{subtitle.join(' — ')}</span>}
                      <span className={`${details} block ${short ? 'sr-only' : 'line-clamp-2'}`}>
                        {[time, compactTime(slot.start, slot.end)].map((when, n) => <span key={n} className={n ? 'hidden @max-[8.5rem]:inline' : '@max-[8.5rem]:hidden'}>
                          {when}{slot.place && <> · <b className="font-bold">{slot.place}</b></>}
                        </span>)}
                      </span>
                    </button>
                  </li>;
                })}
              </ol>
              {day.nowMinute !== null && <div data-testid="schedule-now" className={`pointer-events-none absolute right-0 left-0 z-10 h-0.5 text-[#d93025] ${position}`} style={{ '--minute': day.nowMinute } as CSSProperties}>
                <span className="absolute right-0 left-[var(--time-column)] h-0.5 bg-[#d93025]" />
                <span aria-hidden="true" className="absolute -top-[3px] left-[calc(var(--time-column)_-_4px)] size-2 rounded-full bg-[#d93025]" />
                <span className="absolute -top-1 left-0 -translate-y-full whitespace-nowrap rounded-sm bg-white px-1 text-[11px] leading-4 font-bold">{nowLabel}</span>
              </div>}
            </div>
          </CalendarScroll>}
        </section>;
      })}
    </div>
    <EventDialog selected={open} onClose={() => setOpen(null)} />
    <ul className="mt-5 mb-0 flex list-none flex-wrap gap-x-6 gap-y-3 p-0 text-sm font-bold text-[var(--cal-label)]" aria-label="Event categories">
      {categories.map(c => <li key={c.id} className="flex items-center gap-2"><span aria-hidden="true" className={`size-4 rounded-[3px] border-[1.5px] ring-1 ring-[var(--cal-line)] ${c.classes}`} />{c.label}</li>)}
    </ul>
  </div>;
}
