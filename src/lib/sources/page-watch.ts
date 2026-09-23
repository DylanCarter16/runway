import { createHash } from 'node:crypto';
import { diffArrays } from 'diff';
import { loadPage, squish } from './html';

// Course page watcher (docs/SOURCES.md section 4). Pages are compared as visible
// text: scripts, styles, and comments removed, one line per block, whitespace squished.

const BLOCKS = 'p, div, li, tr, h1, h2, h3, h4, h5, h6, table, ul, ol, dl, dt, dd, pre, blockquote, section, article, header, footer, nav';

export function normalizePageText(html: string): string {
  const $ = loadPage(html);
  $('script, style, noscript, template, head').remove();
  $('br').replaceWith('\n');
  $(BLOCKS).each((_, el) => {
    $(el).prepend('\n').append('\n');
  });
  $('td, th').each((_, el) => {
    $(el).append(' ');
  });
  const text = $('body').length ? $('body').text() : $.root().text();
  return text
    .split('\n')
    .map(squish)
    .filter(Boolean)
    .join('\n');
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export interface PageDiff {
  added: string[];
  removed: string[];
}

/** Lines added and removed between two normalized snapshots, in page order. */
export function diffPageText(before: string, after: string): PageDiff {
  const out: PageDiff = { added: [], removed: [] };
  for (const part of diffArrays(before ? before.split('\n') : [], after ? after.split('\n') : [])) {
    if (part.added) out.added.push(...part.value);
    else if (part.removed) out.removed.push(...part.value);
  }
  return out;
}
