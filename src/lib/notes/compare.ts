import { diffWordsWithSpace } from 'diff';

// Compare view (SPEC 4.5): a word diff from Dylan's original to the cleaned copy.

export interface DiffPart {
  text: string;
  /** 'same', 'added' (only in the cleaned copy), or 'removed' (only in the original). */
  kind: 'same' | 'added' | 'removed';
}

export function wordDiff(original: string, cleaned: string): DiffPart[] {
  return diffWordsWithSpace(original, cleaned).map((c) => ({
    text: c.value,
    kind: c.added ? 'added' : c.removed ? 'removed' : 'same',
  }));
}

/** Parts for one side of the side-by-side view: the original drops additions, the cleaned copy drops removals. */
export function side(parts: DiffPart[], which: 'original' | 'cleaned'): DiffPart[] {
  return parts.filter((p) => (which === 'original' ? p.kind !== 'added' : p.kind !== 'removed'));
}
