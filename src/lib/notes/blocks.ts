// Markdown split into blocks at blank lines, never inside a fenced code block or
// a $$ display math block. Shared by the cleanup splitter and the chunker.

export interface Block {
  text: string;
  /** The heading text when the block starts with a Markdown heading. */
  heading: string | null;
}

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING_RE = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/;

/** About four characters per token: close enough for splitting and budgets. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function splitBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out: Block[] = [];
  let current: string[] = [];
  let fence: string | null = null;
  let displayMath = false;

  const flush = () => {
    const text = current.join('\n').replace(/^\n+|\n+$/g, '');
    if (text.trim()) {
      const first = text.split('\n')[0];
      const m = HEADING_RE.exec(first);
      out.push({ text, heading: m ? m[1] : null });
    }
    current = [];
  };

  for (const line of lines) {
    if (fence) {
      current.push(line);
      if (line.trim().startsWith(fence)) fence = null;
      continue;
    }
    if (displayMath) {
      current.push(line);
      if (line.includes('$$')) displayMath = false;
      continue;
    }
    const f = FENCE_RE.exec(line);
    if (f) {
      current.push(line);
      fence = f[1][0].repeat(3);
      continue;
    }
    if (line.trim() === '$$' || (line.trim().startsWith('$$') && (line.match(/\$\$/g) ?? []).length === 1)) {
      current.push(line);
      displayMath = true;
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    // A heading always starts its own block.
    if (HEADING_RE.test(line) && current.length) flush();
    current.push(line);
  }
  flush();
  return out;
}
