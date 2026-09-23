// Rule-based parser for a Quest class schedule paste (Class Schedule, List View,
// select all, copy). docs/SOURCES.md section 9. No AI: the page is a table.
//
// Browsers paste Quest's table either one row per line with tab-separated cells
// or one cell per line. The parser reads a flat stream of cells, so both work.

export type Day = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';

/** Same shape as courses.meetings (see src/lib/term/seed.ts). */
export interface MeetingJson {
  component: string;
  section: string;
  class_number: string | null;
  days: Day[];
  start: string | null;
  end: string | null;
  location: string | null;
  instructor: string | null;
  starts_on: string | null;
  ends_on: string | null;
}

export interface QuestCourse {
  /** "CS 251" */
  code: string;
  title: string;
  meetings: MeetingJson[];
}

const COURSE_RE = /^([A-Z]{2,6})\s?(\d{3}[A-Z]?)\s+-\s+(.+)$/;
const COMPONENTS = new Set(['LEC', 'TUT', 'LAB', 'TST', 'SEM', 'PRJ', 'SEC', 'STU', 'CLN', 'ESS', 'FLD', 'OLN', 'PRA', 'RDG', 'WRK', 'WSP']);
const DAYS_TIMES_RE = /^((?:Th|Su|M|T|W|F|S)+)\s+(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)$/i;
const DATES_RE = /^(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2})\/(\d{2})\/(\d{4})$/;
const DAY_CODES: Record<string, Day> = { M: 'Mon', T: 'Tue', W: 'Wed', Th: 'Thu', F: 'Fri', S: 'Sat', Su: 'Sun' };

export function parseDays(code: string): Day[] {
  return (code.match(/Th|Su|M|T|W|F|S/g) ?? []).map((c) => DAY_CODES[c]);
}

/** "1:00PM" to "13:00". */
export function to24h(clock: string): string | null {
  const m = /^(\d{1,2}):(\d{2})\s*([AP])M$/i.exec(clock.trim());
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3].toUpperCase() === 'P') h += 12;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

function cells(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n|\t/)
    .map((c) => c.replace(/ /g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function isoDate(mm: string, dd: string, yyyy: string): string {
  return `${yyyy}-${mm}-${dd}`;
}

export function parseQuestSchedule(text: string): QuestCourse[] {
  const out: QuestCourse[] = [];
  let course: QuestCourse | null = null;
  let classNumber: string | null = null;
  let section: string | null = null;
  let component: string | null = null;
  const list = cells(text);

  for (let i = 0; i < list.length; i++) {
    const cell = list[i];
    const header = COURSE_RE.exec(cell);
    if (header) {
      course = { code: `${header[1]} ${header[2]}`, title: header[3].trim(), meetings: [] };
      out.push(course);
      classNumber = section = component = null;
      continue;
    }
    if (!course) continue;

    // Class Nbr, Section, Component: "6120", "001", "LEC".
    if (/^\d{4,5}$/.test(cell) && /^\d{3}$/.test(list[i + 1] ?? '') && COMPONENTS.has(list[i + 2] ?? '')) {
      classNumber = cell;
      section = list[i + 1];
      component = list[i + 2];
      i += 2;
      continue;
    }
    if (/^\d{3}$/.test(cell) && COMPONENTS.has(list[i + 1] ?? '')) {
      classNumber = null;
      section = cell;
      component = list[i + 1];
      i += 1;
      continue;
    }

    const dt = DAYS_TIMES_RE.exec(cell);
    if ((dt || cell === 'TBA') && section && component) {
      // Room, then the instructor (may span cells), then the date range.
      const rest: string[] = [];
      let j = i + 1;
      let dates: RegExpExecArray | null = null;
      while (j < list.length && j <= i + 6) {
        dates = DATES_RE.exec(list[j]);
        if (dates) break;
        if (DAYS_TIMES_RE.test(list[j]) || COURSE_RE.test(list[j])) break;
        rest.push(list[j]);
        j++;
      }
      const room = rest[0] ?? null;
      const instructor = rest.slice(1).join(' ').replace(/\s*,\s*$/, '') || null;
      course.meetings.push({
        component,
        section,
        class_number: classNumber,
        days: dt ? parseDays(dt[1]) : [],
        start: dt ? to24h(dt[2]) : null,
        end: dt ? to24h(dt[3]) : null,
        location: room && room !== 'TBA' ? room : null,
        instructor: instructor && instructor !== 'TBA' && instructor !== 'Staff' ? instructor : null,
        starts_on: dates ? isoDate(dates[1], dates[2], dates[3]) : null,
        ends_on: dates ? isoDate(dates[4], dates[5], dates[6]) : null,
      });
      i = dates ? j : j - 1;
    }
  }
  return out.filter((c) => c.meetings.length > 0);
}
