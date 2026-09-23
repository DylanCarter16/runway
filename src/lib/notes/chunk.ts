import { estimateTokens, splitBlocks } from './blocks';

// Retrieval chunks for Ask (Phase 5 task 6): the note's best copy split by
// heading into chunks of about 400 to 800 tokens. Small sections merge with the
// next one; long sections split at blank lines.

export const CHUNK_MIN_TOKENS = 400;
export const CHUNK_MAX_TOKENS = 800;

export interface NoteChunk {
  ord: number;
  heading: string | null;
  content: string;
  token_estimate: number;
}

interface Section {
  heading: string | null;
  blocks: string[];
}

function sections(md: string): Section[] {
  const out: Section[] = [];
  for (const b of splitBlocks(md)) {
    if (b.heading !== null || !out.length) out.push({ heading: b.heading, blocks: [] });
    out[out.length - 1].blocks.push(b.text);
  }
  return out;
}

/** The copy chunks come from: edited, else cleaned, else the original. */
export function bestCopy(note: { original_md: string; cleaned_md: string | null; edited_md: string | null }): string {
  return note.edited_md ?? note.cleaned_md ?? note.original_md;
}

export function chunkNote(md: string, opts: { min?: number; max?: number } = {}): NoteChunk[] {
  const min = opts.min ?? CHUNK_MIN_TOKENS;
  const max = opts.max ?? CHUNK_MAX_TOKENS;
  const pieces: { heading: string | null; content: string }[] = [];
  let open: { heading: string | null; blocks: string[]; tokens: number } | null = null;

  const close = () => {
    if (open?.blocks.length) pieces.push({ heading: open.heading, content: open.blocks.join('\n\n') });
    open = null;
  };

  for (const s of sections(md)) {
    for (const block of s.blocks) {
      const t = estimateTokens(block);
      if (open && open.tokens + t > max) close();
      open ??= { heading: s.heading, blocks: [], tokens: 0 };
      open.blocks.push(block);
      open.tokens += t;
    }
    // A section that reached the minimum ends its chunk; a short one runs on into the next.
    if (open && (open as { tokens: number }).tokens >= min) close();
  }
  close();
  return pieces.map((p, ord) => ({ ord, heading: p.heading, content: p.content, token_estimate: estimateTokens(p.content) }));
}
