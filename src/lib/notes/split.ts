import { estimateTokens, splitBlocks } from './blocks';

// Cleanup input: the original split into parts of about 3,000 tokens at headings
// or blank lines (docs/PROMPTS.md section 8). A part never cuts a code block or
// display formula; a single block longer than the limit is a part of its own.

export const CLEANUP_PART_TOKENS = 3000;

export function splitForCleanup(md: string, maxTokens = CLEANUP_PART_TOKENS): string[] {
  const parts: string[] = [];
  let current: string[] = [];
  let tokens = 0;
  for (const block of splitBlocks(md)) {
    const t = estimateTokens(block.text);
    // Past half a part, a new heading starts the next part.
    const breakAtHeading = block.heading !== null && tokens > maxTokens / 2;
    if (current.length && (tokens + t > maxTokens || breakAtHeading)) {
      parts.push(current.join('\n\n'));
      current = [];
      tokens = 0;
    }
    current.push(block.text);
    tokens += t;
  }
  if (current.length) parts.push(current.join('\n\n'));
  return parts;
}
