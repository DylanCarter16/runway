// Checks after cleanup (docs/PROMPTS.md section 8): every LaTeX span and fenced
// code block in the original must appear in the cleaned copy unchanged, apart
// from [fixed: ...] marks. Code is compared by its body, so the cleanup may add
// a language tag to the fence.

export const FORMULA_WARNING = 'Cleanup changed a formula or code block. Compare views to review it.';

const FIXED_RE = /\s*\[fixed:[^\]]*\]/g;

function normalize(text: string): string {
  return text
    .replace(FIXED_RE, '')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .trim();
}

/** Bodies of fenced code blocks. */
export function codeBlocks(md: string): string[] {
  const out: string[] = [];
  const re = /^\s{0,3}(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^\s{0,3}\1\s*$/gm;
  for (const m of md.replace(/\r\n?/g, '\n').matchAll(re)) out.push(m[2]);
  return out;
}

/** $$...$$, \[...\], \(...\), and $...$ spans outside code. */
export function mathSpans(md: string): string[] {
  const text = md.replace(/\r\n?/g, '\n').replace(/^\s{0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s{0,3}\1\s*$/gm, '').replace(/`[^`\n]*`/g, '');
  const out: string[] = [];
  const display = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)/g;
  const rest = text.replace(display, (_m, a, b, c) => {
    out.push(a ?? b ?? c);
    return ' ';
  });
  // Inline $...$: no space just inside the dollars, so "$5 and $10" is not math.
  rest.replace(/(?<![\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g, (_m, a) => {
    out.push(a);
    return ' ';
  });
  return out;
}

/** Spans from the original that the cleaned copy lost or changed. */
export function changedSpans(original: string, cleaned: string): string[] {
  const clean = normalize(cleaned);
  const cleanCode = codeBlocks(cleaned).map(normalize);
  const missing: string[] = [];
  for (const body of codeBlocks(original)) {
    const b = normalize(body);
    if (b && !cleanCode.some((c) => c === b) && !clean.includes(b)) missing.push(body);
  }
  for (const span of mathSpans(original)) {
    const s = normalize(span);
    if (s && !clean.includes(s)) missing.push(span);
  }
  return missing;
}
