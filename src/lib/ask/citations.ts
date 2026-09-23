import type Anthropic from '@anthropic-ai/sdk';
import type { AskChunk } from './context';

// Citations (Phase 6 task 4). Claude cites search results by their source
// string, "chunk:<uuid>". Each cited chunk gets a number in order of first use;
// the answer text carries Markdown markers "[n](#source-n)" that the UI turns
// into links to the sources panel.

export interface SavedCitation {
  n: number;
  chunk_id: string;
  parent_type: 'note' | 'document';
  parent_id: string;
  title: string;
  href: string;
  cited_text: string;
}

export function marker(n: number): string {
  return ` [${n}](#source-${n})`;
}

export class CitationTracker {
  private readonly chunks = new Map<string, AskChunk>();
  private readonly numbers = new Map<string, number>();
  readonly saved: SavedCitation[] = [];

  constructor(chunks: AskChunk[] = []) {
    this.add(chunks);
  }

  add(chunks: AskChunk[]): void {
    for (const c of chunks) this.chunks.set(c.id, c);
  }

  known(chunkId: string): boolean {
    return this.chunks.has(chunkId);
  }

  /**
   * Numbers for one text block's citations, deduplicated, in the order cited.
   * New sources are returned in `added` so the caller can announce them.
   */
  cite(citations: Anthropic.TextCitation[] | null | undefined): { numbers: number[]; added: SavedCitation[] } {
    const numbers: number[] = [];
    const added: SavedCitation[] = [];
    for (const c of citations ?? []) {
      if (c.type !== 'search_result_location') continue;
      const id = c.source.startsWith('chunk:') ? c.source.slice('chunk:'.length) : null;
      const chunk = id ? this.chunks.get(id) : undefined;
      if (!chunk) continue;
      let n = this.numbers.get(chunk.id);
      if (n === undefined) {
        n = this.saved.length + 1;
        this.numbers.set(chunk.id, n);
        const saved: SavedCitation = {
          n,
          chunk_id: chunk.id,
          parent_type: chunk.parentType,
          parent_id: chunk.parentId,
          title: chunk.title,
          href: chunk.href,
          cited_text: c.cited_text.slice(0, 2000),
        };
        this.saved.push(saved);
        added.push(saved);
      }
      if (!numbers.includes(n)) numbers.push(n);
    }
    return { numbers, added };
  }
}

/** The markers that follow a cited text block. */
export function markers(numbers: number[]): string {
  return numbers.map(marker).join('');
}
