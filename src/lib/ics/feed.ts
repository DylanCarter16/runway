import { createHash, randomBytes } from 'node:crypto';
import type { EventTime, PlannedEvent } from '@/lib/reminders/events';
import { TIME_ZONE } from '@/lib/time';

// The read-only ICS feed (Phase 8) for Apple Calendar and anything else that
// subscribes to a URL. It renders the same planned events the Google Calendar sync
// writes, so both calendars agree. Pure: the route loads the events and the token.

export const FEED_NAME = 'Runway';
const PRODID = '-//Runway//Course tracker//EN';

/** A new feed token: 32 random bytes, base64url (43 characters). */
export function newFeedToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Lookup key for a token. Only the hash is queried; the token itself is stored encrypted. */
export function hashFeedToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Tokens from newFeedToken; anything else is refused before a database lookup. */
export const FEED_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** `/api/feed/<token>.ics` on the app's origin. */
export function feedUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/$/, '')}/api/feed/${token}.ics`;
}

/** The same URL with the webcal scheme, which opens the subscribe dialog in Apple Calendar. */
export function webcalUrl(httpsUrl: string): string {
  return httpsUrl.replace(/^https?:\/\//, 'webcal://');
}

/** TEXT value escaping (RFC 5545 3.3.11). */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Folds a content line at 75 octets (RFC 5545 3.1). Continuation lines start with
 * one space. Never splits a UTF-8 character.
 */
export function foldLine(line: string): string {
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch, 'utf8');
    // The first line holds 75 octets; continuation lines 74 plus the leading space.
    const limit = parts.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

function utcStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function timeProp(name: 'DTSTART' | 'DTEND', t: EventTime): string {
  if ('date' in t) return `${name};VALUE=DATE:${t.date.replace(/-/g, '')}`;
  return `${name}:${utcStamp(new Date(t.dateTime))}`;
}

function eventLines(e: PlannedEvent, stamp: string): string[] {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${e.runwayId}@runway`,
    `DTSTAMP:${stamp}`,
    timeProp('DTSTART', e.start),
    timeProp('DTEND', e.end),
    `SUMMARY:${escapeText(e.summary)}`,
  ];
  if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
  if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
  lines.push(`TRANSP:${e.transparent ? 'TRANSPARENT' : 'OPAQUE'}`);
  for (const minutes of e.reminders) {
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeText(e.summary)}`,
      `TRIGGER:${minutes === 0 ? 'PT0M' : `-PT${minutes}M`}`,
      'END:VALARM',
    );
  }
  lines.push('END:VEVENT');
  return lines;
}

/** The whole calendar as an iCalendar string with CRLF line endings. */
export function buildIcs(events: PlannedEvent[], now: Date): string {
  const stamp = utcStamp(now);
  const sorted = [...events].sort((a, b) => a.runwayId.localeCompare(b.runwayId));
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${FEED_NAME}`,
    `X-WR-TIMEZONE:${TIME_ZONE}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    ...sorted.flatMap((e) => eventLines(e, stamp)),
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
