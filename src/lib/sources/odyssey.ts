// Rule-based parser for exam rows pasted from Odyssey or Portal (docs/SOURCES.md
// section 8). No AI: the page is a table. Each row names a course, a date, a
// time range, a room, and (a few days before the exam) a seat.

export interface OdysseyRow {
  /** "CS 251" */
  courseCode: string;
  kind: 'midterm' | 'final' | null;
  /** YYYY-MM-DD */
  date: string | null;
  /** HH:MM, 24-hour */
  start: string | null;
  end: string | null;
  location: string | null;
  seat: string | null;
  /** The pasted line, kept as evidence. */
  raw: string;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const COURSE_RE = /\b([A-Z]{2,6})\s?(\d{3}[A-Z]?)\b/;
const TIME_RANGE_RE = /(\d{1,2}):(\d{2})\s*([AaPp])\.?\s*[Mm]\.?\s*(?:-|to|–)\s*(\d{1,2}):(\d{2})\s*([AaPp])\.?\s*[Mm]\.?/;
const TIME_RANGE_24_RE = /\b([01]?\d|2[0-3]):([0-5]\d)\s*(?:-|to|–)\s*([01]?\d|2[0-3]):([0-5]\d)\b/;
const ISO_DATE_RE = /\b(20\d{2})-(\d{2})-(\d{2})\b/;
const NAMED_DATE_RE = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d{2}))?/i;
const SLASH_DATE_RE = /\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/;
const SEAT_LABEL_RE = /\bseat(?:\s*(?:number|no\.?|#))?\s*:?\s*([A-Z]?\d{1,4}[A-Z]?)\b/i;
/** Building codes are 2 to 4 capitals (M3, MC, PAC, STC, E7, RCH); rooms are digits. */
const ROOM_RE = /\b((?:[A-Z]{1,4}\d?|[A-Z]\d))\s+(\d{3,4}[A-Z]?|[A-Z]?\d{1,4}[A-Z]?)\b/g;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function clock(h: number, m: string, ap: string): string {
  let hour = h % 12;
  if (ap.toLowerCase() === 'p') hour += 12;
  return `${pad(hour)}:${m}`;
}

function findDate(line: string, year: number): string | null {
  const iso = ISO_DATE_RE.exec(line);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const named = NAMED_DATE_RE.exec(line);
  if (named) {
    const month = MONTHS[named[1].toLowerCase().replace('.', '')];
    return `${named[3] ?? year}-${pad(month)}-${pad(Number(named[2]))}`;
  }
  const slash = SLASH_DATE_RE.exec(line);
  if (slash) return `${slash[3]}-${pad(Number(slash[1]))}-${pad(Number(slash[2]))}`;
  return null;
}

function findTimes(line: string): { start: string; end: string } | null {
  const ampm = TIME_RANGE_RE.exec(line);
  if (ampm) {
    return { start: clock(Number(ampm[1]), ampm[2], ampm[3]), end: clock(Number(ampm[4]), ampm[5], ampm[6]) };
  }
  const h24 = TIME_RANGE_24_RE.exec(line);
  if (h24) return { start: `${pad(Number(h24[1]))}:${h24[2]}`, end: `${pad(Number(h24[3]))}:${h24[4]}` };
  return null;
}

/**
 * Header-aware split: with a header row ("Course  Date  Time  Location  Seat"),
 * cells are read by column name. Without one, each line is searched by pattern.
 */
function splitCells(line: string): string[] {
  return line.split(/\t| {2,}/).map((c) => c.trim()).filter(Boolean);
}

function findRoomAndSeat(line: string, cols: Record<string, string> | null, courseCode: string): { location: string | null; seat: string | null } {
  if (cols) {
    const location = cols.location || cols.room || cols.building || null;
    const seatCell = cols.seat || cols['seat number'] || null;
    return {
      location: location && !/^tba$/i.test(location) ? location : null,
      seat: seatCell && !/^(tba|n\/a|-)$/i.test(seatCell) ? seatCell : null,
    };
  }
  const seatMatch = SEAT_LABEL_RE.exec(line);
  const seat = seatMatch ? seatMatch[1] : null;
  const withoutSeat = seatMatch ? line.replace(seatMatch[0], ' ') : line;
  const [subject, number] = courseCode.split(' ');
  let location: string | null = null;
  for (const m of withoutSeat.matchAll(ROOM_RE)) {
    if (m[1] === subject && m[2].startsWith(number)) continue;
    if (/^(AM|PM|LEC|TST|TUT|SEC)$/i.test(m[1])) continue;
    location = `${m[1]} ${m[2]}`;
    break;
  }
  return { location, seat };
}

const HEADER_WORDS = ['course', 'date', 'time', 'location', 'room', 'seat', 'building', 'exam', 'type'];

export function parseOdyssey(text: string, year = 2026): OdysseyRow[] {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/ /g, ' '))
    .filter((l) => l.trim());
  let header: string[] | null = null;
  const rows: OdysseyRow[] = [];

  for (const line of lines) {
    const cellsInLine = splitCells(line);
    const lower = cellsInLine.map((c) => c.toLowerCase());
    if (lower.filter((c) => HEADER_WORDS.some((w) => c.includes(w))).length >= 3 && !COURSE_RE.test(line)) {
      header = lower;
      continue;
    }
    const course = COURSE_RE.exec(line);
    if (!course) continue;
    const date = findDate(line, year);
    const times = findTimes(line);
    if (!date && !times) continue;

    let cols: Record<string, string> | null = null;
    if (header && cellsInLine.length === header.length) {
      cols = Object.fromEntries(header.map((h, i) => [h, cellsInLine[i]]));
    }
    const { location, seat } = findRoomAndSeat(line, cols, `${course[1]} ${course[2]}`);
    rows.push({
      courseCode: `${course[1]} ${course[2]}`,
      kind: /final/i.test(line) ? 'final' : /midterm|\bmt\b|\btest\b|\bTST\b/i.test(line) ? 'midterm' : null,
      date,
      start: times?.start ?? null,
      end: times?.end ?? null,
      location,
      seat,
      raw: line.trim().slice(0, 200),
    });
  }
  return rows;
}
