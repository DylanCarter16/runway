// Rule-based reader for pasted marks (LEARN Grades, Crowdmark, Marmoset, MarkUs).
// It runs before the AI switch, so it works for every course. It reads a line
// as a mark only when it clearly is one, so an outline pasted as grades by
// mistake ("Quiz 1   5%   Wednesday, October 7") yields nothing.

export interface ParsedMark {
  label: string;
  score: number;
  out_of: number;
  /** The line it came from, kept as evidence. */
  raw: string;
}

const FRACTION = /(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/;
const PERCENT = /(\d+(?:\.\d+)?)\s*%/;
/** What may follow a percent-only mark: more numbers, never words. */
const NUMERIC_TAIL = /^[\s\d.,/%\-–—]*$/;
const SKIP_LABEL = /^(?:grade item|total|subtotal|final (?:calculated|adjusted) grade|course grade|points|weight|grade)s?\b/i;
const MAX_LABEL_WORDS = 8;
const MAX_LABEL_CHARS = 60;

function cleanLabel(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/^[\s:|\-–—•*]+|[\s:|\-–—•*]+$/g, '')
    .trim();
}

/** "A1 Score" is "A1". Runs after the skip check so "Final calculated grade" stays skipped. */
function shortLabel(label: string): string {
  return label.replace(/\s+(?:score|points|grade|mark)s?$/i, '').trim();
}

function validLabel(label: string): boolean {
  if (!/[a-z]/i.test(label)) return false;
  if (label.length > MAX_LABEL_CHARS || label.split(' ').length > MAX_LABEL_WORDS) return false;
  return !SKIP_LABEL.test(label);
}

export function parseGradePaste(text: string): ParsedMark[] {
  const marks: ParsedMark[] = [];
  for (const line of text.split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw) continue;
    const fraction = FRACTION.exec(raw);
    const percent = PERCENT.exec(raw);
    const useFraction = fraction && (!percent || fraction.index <= percent.index);
    const match = useFraction ? fraction : percent;
    if (!match) continue;
    const full = cleanLabel(raw.slice(0, match.index));
    if (!validLabel(full)) continue;
    const label = shortLabel(full);
    if (useFraction) {
      const score = Number(match[1]);
      const outOf = Number(match[2]);
      if (!(outOf > 0)) continue;
      marks.push({ label, score, out_of: outOf, raw });
    } else {
      if (!NUMERIC_TAIL.test(raw.slice(match.index + match[0].length))) continue;
      marks.push({ label, score: Number(match[1]), out_of: 100, raw });
    }
  }
  return marks;
}
