import { diffArrays } from 'diff';

/**
 * Incremental notes (PHASES.md Phase 9, part B). Dylan keeps one running document per course
 * and pastes all of it after each lecture. This works out which part of a paste is new: blocks
 * appended after what was stored, blocks inserted into earlier sections, and blocks that were
 * edited (revisions). Blocks already stored, including ones that only moved, are skipped.
 * Pure: the caller loads the previous paste and saves the result.
 */

export type BlockStatus = 'new' | 'inserted' | 'revised' | 'same' | 'moved';

export interface PlannedBlock {
  text: string;
  status: BlockStatus;
  /** For a revision: the stored text it replaces. */
  previous?: string;
}

export interface IncrementalPlan {
  /** False on the first paste for a course: everything is new and there is nothing to report. */
  hadPrevious: boolean;
  blocks: PlannedBlock[];
  counts: { new: number; inserted: number; revised: number; skipped: number; skippedLines: number };
  /** The note built from the new material only, in document order, with revisions marked. */
  markdown: string;
  /** True when nothing is new: an identical paste, or only reordering. */
  nothingNew: boolean;
}

export const REVISED_MARK = '*Revised since your last paste:*';
export const INSERTED_MARK = '*Added to an earlier section:*';

/** Similarity at or above this makes an edited block a revision rather than new text. */
const REVISION_SIMILARITY = 0.5;

/**
 * Splits Markdown or plain text into blocks at blank lines. Fenced code (``` or ~~~) and
 * display math ($$) stay whole even when they contain blank lines.
 */
export function splitBlocks(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    if (current.some((l) => l.trim())) blocks.push(current.join('\n').replace(/\s+$/, ''));
    current = [];
  };
  for (const line of lines) {
    const trimmed = line.trim();
    if (fence) {
      current.push(line);
      if (trimmed.startsWith(fence)) fence = null;
      continue;
    }
    const opener = /^(```|~~~)/.exec(trimmed)?.[1] ?? (trimmed === '$$' || (trimmed.startsWith('$$') && !trimmed.slice(2).includes('$$')) ? '$$' : null);
    if (opener) {
      current.push(line);
      fence = opener;
      continue;
    }
    if (!trimmed) {
      flush();
      continue;
    }
    current.push(line);
  }
  flush();
  return blocks;
}

/** Comparison key: whitespace differences alone don't make a block new. */
export function blockKey(block: string): string {
  return block.replace(/\s+/g, ' ').trim();
}

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

/** Jaccard similarity of the two blocks' word sets. */
export function similarity(a: string, b: string): number {
  const wa = words(a);
  const wb = words(b);
  if (!wa.size && !wb.size) return 1;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / (wa.size + wb.size - shared);
}

function lineCount(block: string): number {
  return block.split('\n').length;
}

/**
 * Plans a paste against the previous one for the same course. `earlier` holds every block
 * stored before (all earlier pastes), so text that moved or was pasted again is not new.
 */
export function planIncremental(previous: string | null, next: string, earlier: Iterable<string> = []): IncrementalPlan {
  const nextBlocks = splitBlocks(next);
  const earlierTexts = [...earlier].filter((t) => t.trim());
  // Notes stored before running pastes were kept still count as what was there before.
  const hadPrevious = (previous ?? '').trim() !== '' || earlierTexts.length > 0;
  if (!hadPrevious) {
    const blocks = nextBlocks.map((text) => ({ text, status: 'new' as const }));
    return finish(false, blocks);
  }

  const prevBlocks = splitBlocks(previous ?? '');
  const seen = new Set<string>([...prevBlocks.map(blockKey), ...earlierTexts.flatMap((t) => splitBlocks(t).map(blockKey))]);
  const changes = diffArrays(prevBlocks.map(blockKey), nextBlocks.map(blockKey));

  // Walk the diff, keeping new-paste order. Removed runs next to added runs are candidate revisions.
  const planned: PlannedBlock[] = [];
  let nextIndex = 0;
  let pendingRemoved: string[] = [];
  let prevIndex = 0;
  let pendingAdded: number[] = [];

  const settle = () => {
    // Pair each added block with the most similar removed block from the same spot.
    const removed = [...pendingRemoved];
    for (const i of pendingAdded) {
      const text = planned[i].text;
      let best = -1;
      let bestScore = 0;
      removed.forEach((r, j) => {
        const s = similarity(r, text);
        if (s > bestScore) {
          bestScore = s;
          best = j;
        }
      });
      if (best >= 0 && bestScore >= REVISION_SIMILARITY) {
        planned[i] = { text, status: 'revised', previous: removed[best] };
        removed.splice(best, 1);
      }
    }
    pendingRemoved = [];
    pendingAdded = [];
  };

  for (const change of changes) {
    if (change.removed) {
      pendingRemoved.push(...prevBlocks.slice(prevIndex, prevIndex + change.count));
      prevIndex += change.count;
      continue;
    }
    if (change.added) {
      for (let k = 0; k < change.count; k++) {
        const text = nextBlocks[nextIndex++];
        planned.push({ text, status: seen.has(blockKey(text)) ? 'moved' : 'new' });
        if (planned[planned.length - 1].status === 'new') pendingAdded.push(planned.length - 1);
      }
      continue;
    }
    settle();
    for (let k = 0; k < change.count; k++) planned.push({ text: nextBlocks[nextIndex++], status: 'same' });
    prevIndex += change.count;
  }
  settle();

  // New blocks followed by stored text were inserted into an earlier section.
  let storedAfter = false;
  for (let i = planned.length - 1; i >= 0; i--) {
    const b = planned[i];
    if (b.status === 'same' || b.status === 'moved') storedAfter = true;
    else if (b.status === 'new' && storedAfter) planned[i] = { ...b, status: 'inserted' };
  }
  return finish(true, planned);
}

function finish(hadPrevious: boolean, blocks: PlannedBlock[]): IncrementalPlan {
  const counts = { new: 0, inserted: 0, revised: 0, skipped: 0, skippedLines: 0 };
  const parts: string[] = [];
  for (const b of blocks) {
    if (b.status === 'same' || b.status === 'moved') {
      counts.skipped++;
      counts.skippedLines += lineCount(b.text);
      continue;
    }
    counts[b.status]++;
    if (b.status === 'revised') parts.push(REVISED_MARK, b.text);
    else if (b.status === 'inserted') parts.push(INSERTED_MARK, b.text);
    else parts.push(b.text);
  }
  const markdown = parts.join('\n\n');
  return { hadPrevious, blocks, counts, markdown, nothingNew: markdown === '' };
}

/** The decision line shown after a paste, e.g. "12 new paragraphs, 2 revised, 340 lines skipped". */
export function describePlan(plan: IncrementalPlan): string {
  const { counts } = plan;
  if (!plan.hadPrevious) return 'First paste for this course. Everything is new.';
  if (plan.nothingNew) return `Nothing new. ${plural(counts.skippedLines, 'line')} already stored.`;
  const bits = [plural(counts.new + counts.inserted, 'new paragraph')];
  if (counts.revised) bits.push(`${counts.revised} revised`);
  bits.push(`${plural(counts.skippedLines, 'line')} skipped`);
  return bits.join(', ');
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
