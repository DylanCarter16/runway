import * as cheerio from 'cheerio';

// Helpers shared by the course page parsers. Course pages keep old policies and
// last term's dates inside HTML comments, so every parser starts from stripComments.

/** Removes every HTML comment, including ones that span rows or hide markup. */
export function stripComments(html: string): string {
  return html.replace(/<!--[\s\S]*?(-->|$)/g, '');
}

/** Loads a page with comments already removed. */
export function loadPage(html: string) {
  return cheerio.load(stripComments(html));
}

/** Collapses runs of whitespace (including &nbsp;) to single spaces. */
export function squish(text: string): string {
  return text.replace(/[\s ]+/g, ' ').trim();
}

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/** Month number for "Sep", "Sept", "September", "Nov." and so on; null when unknown. */
export function monthNumber(word: string): number | null {
  const key = word.toLowerCase().replace(/\./g, '');
  if (key.length < 3) return null;
  const i = MONTH_NAMES.findIndex((name) => name.startsWith(key));
  return i < 0 ? null : i + 1;
}

export function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** "10:00 pm", "10:00pm", "4:30" with a meridiem → "22:00". null when it doesn't parse. */
export function clock(hour: string, minute: string | undefined, meridiem: string | undefined): string | null {
  let h = Number(hour);
  const m = minute ? Number(minute) : 0;
  if (!Number.isInteger(h) || !Number.isInteger(m) || m > 59) return null;
  const mer = meridiem?.toLowerCase().replace(/\./g, '');
  if (mer === 'pm' && h < 12) h += 12;
  if (mer === 'am' && h === 12) h = 0;
  if (h > 23) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Resolves a link against the page URL; null for empty or unparseable hrefs. */
export function absoluteUrl(href: string | undefined, pageUrl: string): string | null {
  if (!href?.trim()) return null;
  try {
    return new URL(href.trim(), pageUrl).toString();
  } catch {
    return null;
  }
}

/**
 * True when a CS course URL points at a term folder (F25, W26, S26) other than the
 * page's own. The CS 251 final exam link still points at last fall's page.
 */
export function pointsToOtherTerm(url: string, termFolder: string): boolean {
  const match = /\/~[a-z0-9]+\/([FWS]\d{2})\//i.exec(new URL(url).pathname + '/');
  return Boolean(match && match[1].toUpperCase() !== termFolder.toUpperCase());
}
