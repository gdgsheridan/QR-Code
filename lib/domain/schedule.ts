// SPEC F14 step 4 (v0.8.2): the organizers' schedule text. A line `9:00-10:00 | Title | Place` (end time and
// place optional; -, –, —, → or "to" between the times; 24-hour or 1:00 PM, kept as typed) is a time slot;
// other lines head the slots below them.

export interface ScheduleSlot {
  start: string;
  end: string | null;
  title: string;
  place: string | null;
}

export interface ScheduleSection {
  label: string | null;
  slots: ScheduleSlot[];
}

const TIME = '(?:[01]?\\d|2[0-3]):[0-5]\\d(?:\\s*[AaPp]\\.?[Mm]\\.?)?';
const SLOT = new RegExp(`^(${TIME})(?:\\s*(?:-|–|—|→|to)\\s*(${TIME}))?\\s*\\|(.*)$`);

function slot(line: string): ScheduleSlot | null {
  const m = SLOT.exec(line);
  if (!m) return null;
  const [title = '', ...rest] = (m[3] ?? '').split('|').map((s) => s.trim());
  const place = rest.join(' | ');
  return title ? { start: m[1] ?? '', end: m[2] ?? null, title, place: place || null } : null;
}

// Null when no line is a slot: the text is then shown as written, line breaks kept.
export function parseSchedule(text: string): ScheduleSection[] | null {
  const sections: ScheduleSection[] = [];
  let found = false;
  for (const line of text.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const s = slot(line);
    const last = sections.at(-1);
    if (s) {
      found = true;
      if (last) last.slots.push(s);
      else sections.push({ label: null, slots: [s] });
    } else if (last && last.label !== null && last.slots.length === 0) {
      last.label += `\n${line}`;
    } else {
      sections.push({ label: line, slots: [] });
    }
  }
  return found ? sections : null;
}
export type ScheduleCategory = 'hacking' | 'activities' | 'workshops' | 'food' | 'sponsors';
export type ScheduleTrack = 'main' | 'food' | 'side';
export interface TimelineSlot extends ScheduleSlot {
  startMinute: number;
  endMinute: number;
  category: ScheduleCategory;
  // Poster layout: `left` and `width` are fractions of the day; `depth` is the inset level among
  // overlapping slots of the same track; higher `layer`s draw on top; `nudged` sits below a title it covers.
  // `topMinute` is where the card is drawn from: its start, or an hour later when it would hide a same-column card
  // starting with it (Photo Booth on Sponsor Station); its text still says the real start.
  track: ScheduleTrack;
  topMinute: number;
  left: number;
  width: number;
  depth: number;
  layer: number;
  nudged: boolean;
  state: 'past' | 'current' | 'upcoming';
}
export interface TimelineDay {
  nowMinute: number | null;
  isToday: boolean;
  label: string | null;
  slots: TimelineSlot[];
  unscheduled: ScheduleSlot[];
  startMinute: number;
  endMinute: number;
}

function minutes(time: string): number | null {
  const match = /^(\d{1,2}):([0-5]\d)\s*([ap])\.?m\.?$/i.exec(time.trim())
    ?? /^(\d{1,2}):([0-5]\d)$/.exec(time.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  if (match[3] ? hour < 1 || hour > 12 : hour > 23) return null;
  return (match[3] ? hour % 12 + (match[3].toLowerCase() === 'p' ? 12 : 0) : hour) * 60 + Number(match[2]);
}

// First match wins: Workshop/Talk/MLH Meetup; meals/snacks; Sponsor; hacking milestones;
// everything else is Activities. MLH Meetup is a workshop and Team formation is hacking, to match the official poster.
const CATEGORY_RULES: [RegExp, ScheduleCategory][] = [
  [/\b(workshop|talk|MLH\s+Meetup)\b/i, 'workshops'],
  [/\b(lunch|dinner|breakfast|snacks?)\b/i, 'food'],
  [/\bsponsor\b/i, 'sponsors'],
  [/\b(hacking\s+(begins|ends)|devpost|draft\s+due|demos|judging|quiet\s+rooms|team\s+formation)\b/i, 'hacking'],
];

// Like the Hacker Package poster: hacking and workshops left, food in the middle, sponsors and activities right.
const TRACKS: { id: ScheduleTrack; weight: number; categories: ScheduleCategory[] }[] = [
  { id: 'main', weight: 4, categories: ['hacking', 'workshops'] },
  { id: 'food', weight: 2.5, categories: ['food'] },
  { id: 'side', weight: 3.5, categories: ['sponsors', 'activities'] },
];
const NUDGE_WITHIN = 15;
const DROP_MINUTES = 60; // a long card on a same-column one starting with it begins this much lower
const DROP_MIN_LENGTH = 120;
const NEIGHBOUR_WITHIN = 15; // a lone slot this close to another column's slot keeps its own column
const overlaps = (a: { startMinute: number; endMinute: number }, b: { startMinute: number; endMinute: number }) =>
  a.startMinute < b.endMinute && b.startMinute < a.endMinute;

// A slot whose overlap group stays in its own track, with no other track's slot right beside it, spans the day; hacking also runs under the food column
// (food draws on top) and into the side column when that is free; overlaps in one track stack, each a step further in than the cards it covers.
function layout(slots: TimelineSlot[]) {
  const used = TRACKS.filter(t => slots.some(s => s.track === t.id));
  const total = used.reduce((sum, t) => sum + t.weight, 0);
  const extent = (from: number, to: number) => ({
    left: used.slice(0, from).reduce((sum, t) => sum + t.weight, 0) / total,
    width: used.slice(from, to + 1).reduce((sum, t) => sum + t.weight, 0) / total,
  });
  const groups: TimelineSlot[][] = [];
  let groupEnd = -Infinity;
  for (const slot of slots) {
    if (slot.startMinute >= groupEnd) groups.push([]);
    groups.at(-1)!.push(slot);
    groupEnd = Math.max(groupEnd, slot.endMinute);
  }
  slots.forEach((slot, i) => {
    const own = used.findIndex(t => t.id === slot.track);
    const group = groups.find(g => g.includes(slot))!;
    let [from, to] = [own, own];
    const alone = group.every(s => s.track === slot.track) && !slots.some(s => s.track !== slot.track
      && s.startMinute < slot.endMinute + NEIGHBOUR_WITHIN && slot.startMinute - NEIGHBOUR_WITHIN < s.endMinute);
    if (alone) [from, to] = [0, used.length - 1];
    else if (slot.category === 'hacking') {
      const free = (track: ScheduleTrack) => !slots.some(s => s.track === track && overlaps(s, slot));
      while (to + 1 < used.length && (used[to + 1]!.id === 'food' || free(used[to + 1]!.id))) to += 1;
    }
    const below = slots.slice(0, i).filter(s => s.track === slot.track && overlaps(s, slot));
    const depth = below.length ? Math.max(...below.map(s => s.depth)) + 1 : 0;
    Object.assign(slot, extent(from, to), { depth, layer: i + (slot.track === 'food' ? slots.length : 0) });
  });
  for (const slot of slots) {
    const covered = slots.filter(s => s.layer < slot.layer && overlaps(s, slot)
      && s.left < slot.left + slot.width && slot.left < s.left + s.width
      && slot.startMinute - s.startMinute < NUDGE_WITHIN);
    const drop = slot.endMinute - slot.startMinute >= DROP_MIN_LENGTH && covered.some(s => s.track === slot.track
      && s.endMinute - s.startMinute > DROP_MINUTES);
    slot.topMinute = slot.startMinute + (drop ? DROP_MINUTES : 0);
    slot.nudged = covered.length > 0 && !drop;
  }
}

// Intl extracts civil time in the event zone; UTC below is only calendar-day arithmetic.
function civilTime(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(p => p.type === type)?.value);
  return { year: part('year'), date: Date.UTC(part('year'), part('month') - 1, part('day')), minute: part('hour') * 60 + part('minute') };
}

function sectionDate(label: string | null, reference: { year: number; date: number }): number | null {
  const match = /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:,?\s+(\d{4}))?\b/i.exec(label ?? '');
  if (!match) return null;
  const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(match[1]!.slice(0, 3).toLowerCase());
  const day = Number(match[2]);
  const years = match[3] ? [Number(match[3])] : [reference.year - 1, reference.year, reference.year + 1];
  const candidates = years.map(year => Date.UTC(year, month, day)).filter(date => new Date(date).getUTCMonth() === month);
  return candidates.sort((a, b) => Math.abs(a - reference.date) - Math.abs(b - reference.date))[0] ?? null;
}

export function scheduleTimeline(sections: ScheduleSection[], now?: Date, timezone = 'UTC', eventStartsAt?: string): TimelineDay[] {
  const local = now && Number.isFinite(now.getTime()) ? civilTime(now, timezone) : null;
  const reference = eventStartsAt ? civilTime(new Date(eventStartsAt), timezone) : local;
  return sections.map(section => {
    const date = reference ? sectionDate(section.label, reference) : null;
    const relativeNow = local && date !== null ? (local.date - date) / 60_000 + local.minute : null;
    const slots: TimelineSlot[] = [];
    const unscheduled: ScheduleSlot[] = [];
    let seenAfternoon = false;
    for (const slot of section.slots) {
      const start = minutes(slot.start);
      if (start === null) { unscheduled.push({ ...slot }); continue; }
      const offset = start < 360 && seenAfternoon ? 1440 : 0;
      if (start >= 720) seenAfternoon = true;
      const startMinute = start + offset;
      const end = slot.end ? minutes(slot.end) : null;
      let endMinute = end === null ? startMinute + 30 : end + offset;
      if (endMinute < startMinute) endMinute += 1440;
      if (endMinute === startMinute) endMinute += 30;
      const category = CATEGORY_RULES.find(([rule]) => rule.test(slot.title))?.[1] ?? 'activities';
      slots.push({ ...slot, startMinute, endMinute, category,
        track: TRACKS.find(t => t.categories.includes(category))!.id, topMinute: startMinute, left: 0, width: 1, depth: 0, layer: 0, nudged: false,
        state: relativeNow === null || relativeNow < startMinute ? 'upcoming' : relativeNow >= endMinute ? 'past' : 'current' });
    }
    slots.sort((a, b) => a.startMinute - b.startMinute);
    layout(slots);
    const first = Math.min(...slots.map(s => s.startMinute));
    const last = Math.max(...slots.map(s => s.endMinute));
    return { label: section.label, slots, unscheduled,
      isToday: local !== null && date === local.date,
      nowMinute: relativeNow !== null && relativeNow >= first && relativeNow < last ? relativeNow : null,
      startMinute: slots.length ? Math.floor(Math.min(...slots.map(s => s.startMinute)) / 60) * 60 : 480,
      endMinute: slots.length ? Math.ceil(Math.max(...slots.map(s => s.endMinute)) / 60) * 60 : 1080 };
  });
}
