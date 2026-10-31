import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSchedule, scheduleTimeline, type ScheduleSlot } from '@/lib/domain/schedule';

const official = readFileSync(new URL('../fixtures/schedule/official.txt', import.meta.url), 'utf8');
const makeSlot = (start: string, end: string | null = null, title = 'Activity'): ScheduleSlot => ({ start, end, title, place: null });

describe('scheduleTimeline', () => {
  it('T-ME-11: real poster has 23 Saturday and 6 Sunday slots, including the same night past midnight', () => {
    const days = scheduleTimeline(parseSchedule(official)!);
    expect(days.map(d => d.slots.length)).toEqual([23, 6]);
    expect(days.map(d => [d.startMinute, d.endMinute])).toEqual([[540, 1560], [480, 960]]);
    const saturday = days[0]!;
    expect(saturday.slots.find(s => s.title === 'Spin the Wheel')).toMatchObject({ startMinute: 1320, endMinute: 1440 });
    expect(saturday.slots.find(s => s.title === 'Magic: The Gathering')).toMatchObject({ startMinute: 1440, endMinute: 1560 });
    expect(saturday.slots.find(s => s.title === 'Opening Ceremony')).toMatchObject({ startMinute: 660, endMinute: 690 });
  });

  it('T-ME-11: poster columns: similar events share a column, free slots span the day, overlaps stack on top', () => {
    const [saturday, sunday] = scheduleTimeline(parseSchedule(official)!);
    const all = [...saturday!.slots, ...sunday!.slots];
    const find = (day: typeof saturday, title: string) => day!.slots.find(s => s.title.startsWith(title))!;
    for (const s of all) expect(s.track).toBe(s.category === 'food' ? 'food' : s.category === 'hacking' || s.category === 'workshops' ? 'main' : 'side');
    for (const s of all) { expect(s.left).toBeGreaterThanOrEqual(0); expect(s.left + s.width).toBeLessThanOrEqual(1 + 1e-9); }
    const full = (s: { left: number; width: number }) => [s.left, s.width];
    for (const title of ['Check-in', 'Opening Ceremony']) expect(full(find(saturday, title))).toEqual([0, 1]);
    for (const title of ['Breakfast', 'Talk: IBM', 'Hacking Ends', 'Demos', 'Closing']) expect(full(find(sunday, title))).toEqual([0, 1]);
    // Saturday: main 40%, food 25%, side 35%.
    const workshops = saturday!.slots.filter(s => s.title.startsWith('Workshop'));
    expect(workshops).toHaveLength(5);
    for (const w of workshops) expect([w.left, w.width]).toEqual([0, 0.4]);
    expect(full(find(saturday, 'Hacking Begins'))).toEqual([0, 0.65]);
    expect(full(find(saturday, 'Team formation'))).toEqual([0, 0.65]); // inside the red Hacking Begins block on the poster
    // Free-standing, but next to another column's slot: stays in its own column like the poster.
    expect(full(find(saturday, 'Fitness Challenge'))).toEqual([0.65, 0.35]);
    expect(full(find(saturday, 'Lunch'))).toEqual([0.4, 0.25]);
    expect(full(find(saturday, 'Sponsor Station'))).toEqual([0.65, 0.35]);
    // Food sits on top of hacking, nudged below its title; Photo Booth stacks on Sponsor Station.
    expect(find(saturday, 'Lunch').layer).toBeGreaterThan(find(saturday, 'Hacking Begins').layer);
    expect(find(saturday, 'Lunch').nudged).toBe(true);
    expect(find(sunday, 'Lunch').layer).toBeGreaterThan(find(sunday, 'Hacking Ends').layer);
    // Photo Booth (12–8) would hide Sponsor Station (12–6): drawn from 1 PM, so Sponsor's title, time and place show.
    expect(find(saturday, 'Photo Booth')).toMatchObject({ depth: 1, nudged: false, startMinute: 720, topMinute: 780, start: '12:00 PM' });
    expect(find(saturday, 'Sponsor Station').topMinute).toBe(720);
    expect(find(saturday, 'Lunch').topMinute).toBe(720);
    expect(find(saturday, 'Photo Booth').layer).toBeGreaterThan(find(saturday, 'Sponsor Station').layer);
    expect(find(saturday, 'Hacking Begins').nudged).toBe(false);
    expect(find(saturday, 'Team formation').nudged).toBe(false);
    // Stair-step cascade: a later card steps in past every card it covers, so each one keeps a visible edge.
    expect(find(saturday, 'Caricatures').depth).toBe(2);
    expect(find(saturday, 'Karaoke').depth).toBe(1);
    for (const day of [saturday!, sunday!]) for (const a of day.slots) for (const b of day.slots) {
      if (a !== b && a.track === b.track && a.startMinute < b.endMinute && b.startMinute < a.endMinute) {
        expect(a.depth).not.toBe(b.depth);
        expect(a.layer).not.toBe(b.layer);
      }
    }
    const [day] = scheduleTimeline([{ label: 'Day', slots: [makeSlot('9:00', '10:00'), makeSlot('9:30', '10:30'), makeSlot('10:30', '11:00'), makeSlot('9:00', '9:30', 'Lunch')] }]);
    expect(day!.slots.map(s => [s.title, s.track, s.left, s.width, s.depth])).toEqual([
      ['Activity', 'side', 2.5 / 6, 3.5 / 6, 0], ['Lunch', 'food', 0, 2.5 / 6, 0], ['Activity', 'side', 2.5 / 6, 3.5 / 6, 1], ['Activity', 'side', 0, 1, 0]]);
  });

  it('T-ME-11: title categories match the poster, including MLH Meetup', () => {
    const days = scheduleTimeline(parseSchedule(official)!);
    const category = (title: string) => days.flatMap(d => d.slots).find(s => s.title.startsWith(title))?.category;
    for (const title of ['Hacking Begins', 'Team formation', 'Hacking Ends', 'Devpost', 'Quiet Rooms', 'Demos']) expect(category(title)).toBe('hacking');
    for (const title of ['Lunch', 'Dinner', 'Breakfast', 'Snack Cart', 'Late-Night Snacks']) expect(category(title)).toBe('food');
    for (const title of ['Workshop', 'Talk', 'MLH Meetup']) expect(category(title)).toBe('workshops');
    expect(category('Sponsor')).toBe('sponsors');
    for (const title of ['Check-in', 'Opening', 'Photo Booth', 'Caricatures', 'Fitness', 'Spin', 'Karaoke', 'Magic']) expect(category(title)).toBe('activities');
  });

  it('T-ME-11: typed 24-hour, AM/PM, compact and dotted times; overnight rollover and rounding', () => {
    const slots = [makeSlot('9:00', '10:01'), makeSlot('9:00 AM'), makeSlot('9:30am'), makeSlot('2:15 p.m.'), makeSlot('23:30', '00:15'), makeSlot('1:00', '02:15')];
    const [day] = scheduleTimeline([{ label: 'Day', slots }]);
    expect(day!.slots.map(s => [s.startMinute, s.endMinute])).toEqual([[540, 601], [540, 570], [570, 600], [855, 885], [1410, 1455], [1500, 1575]]);
    expect([day!.startMinute, day!.endMinute]).toEqual([540, 1620]);
    expect(scheduleTimeline([{ label: null, slots: [makeSlot('2:00 AM')] }])[0]!.slots[0]!.startMinute).toBe(120);
  });

  it('T-ME-11: malformed times are preserved outside the grid, bad ends use 30 minutes, empty days never throw', () => {
    const [day, empty] = scheduleTimeline([{ label: 'Day', slots: [makeSlot('broken'), makeSlot('25:00'), makeSlot('13:00 PM'), makeSlot('9:60'), makeSlot('9:00', 'oops')] }, { label: 'Empty', slots: [] }]);
    expect(day!.unscheduled).toHaveLength(4);
    expect(day!.slots[0]).toMatchObject({ startMinute: 540, endMinute: 570 });
    expect(empty).toMatchObject({ slots: [], unscheduled: [], startMinute: 480, endMinute: 1080 });
    expect(scheduleTimeline([])).toEqual([]);
  });
});

describe('live schedule state', () => {
  const sections = parseSchedule(official)!;
  const at = (instant: string, zone = 'America/Toronto') => scheduleTimeline(sections, new Date(instant), zone, '2026-11-07T14:00:00Z');
  it('T-ME-11: upcoming, current and past at the exact start/end boundaries in the event timezone', () => {
    expect(at('2026-11-07T13:59:00Z')[0]!.slots[0]!.state).toBe('upcoming');
    expect(at('2026-11-07T14:00:00Z')[0]!.slots[0]!.state).toBe('current');
    expect(at('2026-11-07T15:45:00Z')[0]!.slots[0]!.state).toBe('past');
    const days = at('2026-11-07T19:40:00Z');
    expect(days[0]!.nowMinute).toBe(880);
    expect(days[1]!.nowMinute).toBeNull();
    expect(days[0]!.slots.find(s => s.title.startsWith('Workshop: Google'))!.state).toBe('current');
    expect(days[0]!.slots.find(s => s.title === 'Dinner')!.state).toBe('upcoming');
    expect(days[0]!.slots.find(s => s.title === 'Lunch')!.state).toBe('past');
  });
  it('T-ME-11: after midnight belongs to Saturday night until its last event ends', () => {
    const days = at('2026-11-08T06:00:00Z');
    expect(days[0]!.nowMinute).toBe(1500);
    expect(days[1]!.nowMinute).toBeNull();
    expect(days[0]!.slots.find(s => s.title === 'Magic: The Gathering')!.state).toBe('current');
    expect(days[0]!.slots.find(s => s.title === 'Spin the Wheel')!.state).toBe('past');
    expect(at('2026-11-08T07:00:00Z').every(d => d.nowMinute === null)).toBe(true);
    expect(at('2026-11-08T12:00:00Z')[1]!.isToday).toBe(true);
  });
  it('T-ME-11: civil dates and times use the supplied timezone even when UTC is the previous day', () => {
    expect(at('2026-11-07T23:40:00Z', 'Asia/Tokyo')[1]!.nowMinute).toBe(520);
    expect(at('2026-11-07T05:40:00Z', 'Asia/Tokyo')[0]!.nowMinute).toBe(880);
  });
  it('T-ME-11: no line outside the event, in another year, or for an undated heading', () => {
    expect(at('2026-11-06T19:40:00Z').every(d => d.nowMinute === null)).toBe(true);
    expect(at('2027-11-07T19:40:00Z').every(d => d.nowMinute === null)).toBe(true);
    expect(at('2026-11-09T19:40:00Z').flatMap(d => d.slots).every(s => s.state === 'past')).toBe(true);
    expect(scheduleTimeline([{ label: 'Day', slots: [makeSlot('9:00')] }], new Date('2026-11-07T14:00:00Z'), 'America/Toronto')[0]!.nowMinute).toBeNull();
  });
});
