import ical, { type VEvent } from 'node-ical';
import { describe, expect, it } from 'vitest';
import {
  buildIcs,
  escapeText,
  FEED_TOKEN_PATTERN,
  feedUrl,
  foldLine,
  hashFeedToken,
  newFeedToken,
  webcalUrl,
} from '@/lib/ics/feed';
import { planItemEvents, planReminderEvent, type PlanItem } from '@/lib/reminders/events';
import { fromTorontoLocal } from '@/lib/time';

const ctx = { appUrl: 'https://runway.example', studyBlockHour: 19 };
const NOW = new Date('2026-09-23T12:00:00Z');

function item(over: Partial<PlanItem> = {}): PlanItem {
  return {
    id: 'a1',
    kind: 'assignment',
    title: 'A1',
    courseCode: 'CS 251',
    courseSlug: 'cs251',
    due_at: fromTorontoLocal('2026-09-30', '22:00').toISOString(),
    starts_at: null,
    ends_at: null,
    all_day: false,
    time_known: true,
    location: null,
    seat: null,
    state: 'active',
    progress: 'todo',
    created_at: '2026-09-01T12:00:00Z',
    source_url: 'https://student.cs.uwaterloo.ca/~cs251/assignments.html',
    prep_days: null,
    reminder_minutes: null,
    ...over,
  };
}

function parse(ics: string): VEvent[] {
  return Object.values(ical.sync.parseICS(ics)).filter((c): c is VEvent => c?.type === 'VEVENT');
}

describe('feed tokens', () => {
  it('makes 43-character url-safe tokens that differ each time', () => {
    const a = newFeedToken();
    const b = newFeedToken();
    expect(a).toMatch(FEED_TOKEN_PATTERN);
    expect(b).toMatch(FEED_TOKEN_PATTERN);
    expect(a).not.toBe(b);
  });

  it('hashes to 64 hex characters, the same each time', () => {
    const t = newFeedToken();
    expect(hashFeedToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashFeedToken(t)).toBe(hashFeedToken(t));
    expect(hashFeedToken(t)).not.toBe(hashFeedToken(newFeedToken()));
  });

  it('refuses shapes that are not tokens', () => {
    expect(FEED_TOKEN_PATTERN.test('short')).toBe(false);
    expect(FEED_TOKEN_PATTERN.test(`${'a'.repeat(42)}/`)).toBe(false);
    expect(FEED_TOKEN_PATTERN.test('a'.repeat(44))).toBe(false);
  });

  it('builds the https and webcal URLs', () => {
    const url = feedUrl('https://runway.example/', 'tok');
    expect(url).toBe('https://runway.example/api/feed/tok.ics');
    expect(webcalUrl(url)).toBe('webcal://runway.example/api/feed/tok.ics');
  });
});

describe('text escaping and folding', () => {
  it('escapes backslashes, semicolons, commas, and newlines', () => {
    expect(escapeText('a\\b;c,d\ne\r\nf')).toBe('a\\\\b\\;c\\,d\\ne\\nf');
  });

  it('leaves short lines alone', () => {
    expect(foldLine('SUMMARY:A1')).toBe('SUMMARY:A1');
  });

  it('folds at 75 octets without splitting a multi-byte character', () => {
    const line = `SUMMARY:${'✓'.repeat(60)}`;
    const folded = foldLine(line);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    expect(Buffer.byteLength(parts[0]!, 'utf8')).toBeLessThanOrEqual(75);
    for (const p of parts.slice(1)) {
      expect(p.startsWith(' ')).toBe(true);
      expect(Buffer.byteLength(p, 'utf8')).toBeLessThanOrEqual(75);
    }
    expect(parts.map((p, i) => (i === 0 ? p : p.slice(1))).join('')).toBe(line);
  });
});

describe('buildIcs', () => {
  it('wraps events in a named calendar with CRLF line endings', () => {
    const ics = buildIcs([], NOW);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics).toContain('X-WR-CALNAME:Runway\r\n');
    expect(ics).toContain('X-WR-TIMEZONE:America/Toronto\r\n');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('renders a timed deadline with its prep day, start block, and alarms', () => {
    const events = planItemEvents(item(), ctx);
    const parsed = parse(buildIcs(events, NOW));
    expect(parsed).toHaveLength(events.length);

    const main = parsed.find((e) => e.uid === 'item:a1@runway')!;
    expect(main.summary).toBe('CS 251 A1');
    // Due 22:00 EDT = 02:00Z the next day; the event is the 15 minutes before it.
    expect(main.end?.toISOString()).toBe('2026-10-01T02:00:00.000Z');
    expect(main.start.toISOString()).toBe('2026-10-01T01:45:00.000Z');
    expect(String(main.description)).toContain('https://runway.example/items/a1');
    expect(main.transparency).toBe('OPAQUE');
    expect(events[0]!.reminders.length).toBeGreaterThan(0);
    expect(main.alarms ?? []).toHaveLength(events[0]!.reminders.length);

    const prep = parsed.find((e) => e.uid === 'item:a1:prep@runway')!;
    expect(prep.datetype).toBe('date');
    expect(prep.transparency).toBe('TRANSPARENT');
    expect(parsed.some((e) => e.uid === 'item:a1:start@runway')).toBe(true);
  });

  it('writes all-day items as DATE values with an exclusive end', () => {
    const allDay = item({ due_at: fromTorontoLocal('2026-11-02', null).toISOString(), all_day: true, time_known: false });
    const ics = buildIcs(planItemEvents(allDay, ctx), NOW);
    expect(ics).toContain('DTSTART;VALUE=DATE:20261102\r\n');
    expect(ics).toContain('DTEND;VALUE=DATE:20261103\r\n');
    expect(ics).toContain('SUMMARY:CS 251 A1 (time TBD)\r\n');
  });

  it('keeps exam times right on both sides of the DST change', () => {
    const before = item({
      id: 'm1',
      kind: 'midterm',
      title: 'Midterm',
      due_at: null,
      starts_at: fromTorontoLocal('2026-10-29', '16:30').toISOString(),
      ends_at: fromTorontoLocal('2026-10-29', '18:20').toISOString(),
      location: 'STC 0010',
    });
    const after = { ...before, id: 'm2', starts_at: fromTorontoLocal('2026-11-12', '16:30').toISOString(), ends_at: fromTorontoLocal('2026-11-12', '18:20').toISOString() };
    const ics = buildIcs([...planItemEvents(before, ctx), ...planItemEvents(after, ctx)], NOW);
    expect(ics).toContain('DTSTART:20261029T203000Z\r\n');
    expect(ics).toContain('DTSTART:20261112T213000Z\r\n');
    const parsed = parse(ics);
    expect(parsed.find((e) => e.uid === 'item:m1@runway')!.location).toBe('STC 0010');
  });

  it('marks submitted items and gives them no alarms or prep', () => {
    const done = planItemEvents(item({ progress: 'submitted' }), ctx);
    const ics = buildIcs(done, NOW);
    expect(ics).toContain('SUMMARY:✓ CS 251 A1\r\n');
    expect(ics).not.toContain('BEGIN:VALARM');
    expect(ics).not.toContain('item:a1:prep');
  });

  it('includes paste reminders with an alarm at the start', () => {
    const r = planReminderEvent(
      { id: 'r1', title: 'Paste Quest', where_to_find: 'Quest, Class schedule', url: null, remind_at: '2026-09-28T13:00:00Z', snoozed_until: null, done_at: null },
      ctx.appUrl,
    )!;
    const ics = buildIcs([r], NOW);
    expect(ics).toContain('UID:reminder:r1@runway\r\n');
    expect(ics).toContain('TRIGGER:PT0M\r\n');
    expect(ics).toContain('DESCRIPTION:Quest\\, Class schedule\\nMark it done');
  });

  it('is the same text for the same events, whatever their order', () => {
    const events = planItemEvents(item(), ctx);
    expect(buildIcs([...events].reverse(), NOW)).toBe(buildIcs(events, NOW));
  });
});
