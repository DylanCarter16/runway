import { describe, expect, it } from 'vitest';
import { splitBlocks } from '@/lib/notes/blocks';
import { bestCopy, chunkNote } from '@/lib/notes/chunk';
import { splitForCleanup } from '@/lib/notes/split';

const para = (n: number, words = 60) => `Paragraph ${n}. ` + 'word '.repeat(words).trim();

describe('blocks', () => {
  it('keeps code fences and display math whole across blank lines', () => {
    const md = '# A\ntext\n\n```py\nx = 1\n\ny = 2\n```\n\n$$\na\n\nb\n$$\n\nend';
    const blocks = splitBlocks(md);
    expect(blocks.map((b) => b.text)).toEqual(['# A\ntext', '```py\nx = 1\n\ny = 2\n```', '$$\na\n\nb\n$$', 'end']);
    expect(blocks[0].heading).toBe('A');
  });

  it('starts a block at a heading even without a blank line', () => {
    expect(splitBlocks('intro\n## Next\nbody').map((b) => b.heading)).toEqual([null, 'Next']);
  });
});

describe('cleanup parts', () => {
  it('keeps a short note in one part', () => {
    expect(splitForCleanup('a\n\nb')).toEqual(['a\n\nb']);
  });

  it('splits a long note into parts of about 3,000 tokens without losing text', () => {
    const md = Array.from({ length: 80 }, (_, i) => (i % 10 === 0 ? `# Section ${i}\n` : '') + para(i)).join('\n\n');
    const parts = splitForCleanup(md);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length / 4).toBeLessThanOrEqual(3000);
    expect(parts.join('\n\n')).toBe(md);
  });

  it('prefers a heading boundary once a part is half full', () => {
    const md = [para(1, 1400), '# Next topic', para(2, 20)].join('\n\n');
    const parts = splitForCleanup(md);
    expect(parts).toHaveLength(2);
    expect(parts[1].startsWith('# Next topic')).toBe(true);
  });
});

describe('chunks', () => {
  it('splits by heading and merges short sections', () => {
    const md = '# One\nshort\n\n# Two\nalso short\n\n# Three\n' + para(3, 300);
    const chunks = chunkNote(md);
    expect(chunks[0].heading).toBe('One');
    expect(chunks[0].content).toContain('# Two');
    expect(chunks.map((c) => c.ord)).toEqual(chunks.map((_, i) => i));
    for (const c of chunks) expect(c.token_estimate).toBeLessThanOrEqual(800);
  });

  it('splits a long section at blank lines into chunks of at most 800 tokens', () => {
    const md = '# Long\n\n' + Array.from({ length: 20 }, (_, i) => para(i, 100)).join('\n\n');
    const chunks = chunkNote(md);
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) {
      expect(c.heading).toBe('Long');
      expect(c.token_estimate).toBeLessThanOrEqual(800);
    }
  });

  it('uses the edited copy, else the cleaned copy, else the original', () => {
    expect(bestCopy({ original_md: 'o', cleaned_md: 'c', edited_md: 'e' })).toBe('e');
    expect(bestCopy({ original_md: 'o', cleaned_md: 'c', edited_md: null })).toBe('c');
    expect(bestCopy({ original_md: 'o', cleaned_md: null, edited_md: null })).toBe('o');
  });
});
