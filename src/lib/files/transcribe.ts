import type Anthropic from '@anthropic-ai/sdk';
import { callClaude, ClaudeError, type AiDeps } from '@/lib/ai/client';
import { TRANSCRIBE_SYSTEM } from '@/lib/ai/prompts';
import { escapeSource } from '@/lib/ai/prompts/shared';
import { transcribeResult } from '@/lib/ai/schemas';
import type { AiClearance } from '@/lib/ai/switch';

// Claude vision for scanned or handwritten pages and photos (PROMPTS.md section 11). One call
// reads a few pages sent as their own small PDF, or one image. Only a clearance from the AI
// switch can make the call, so AI-off courses never get here.

export type Attachment = { kind: 'pdf'; bytes: Uint8Array } | { kind: 'image'; bytes: Uint8Array; mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' };

export interface TranscribeInput {
  userId: string;
  clearance: AiClearance;
  documentId: string;
  courseLabel: string;
  fileName: string;
  /** The pages of the original file this attachment holds, in attachment order. */
  pages: number[];
  totalPages: number;
  attachment: Attachment;
}

export interface PageText {
  markdown: string;
  blank: boolean;
}

export function transcriptionUserTurn(input: Pick<TranscribeInput, 'courseLabel' | 'fileName' | 'pages' | 'totalPages' | 'attachment'>): string {
  const what = input.attachment.kind === 'pdf' ? `The attached PDF holds ${input.pages.length === 1 ? 'one page' : `${input.pages.length} pages`}` : 'The attached image is one page';
  const order = input.pages.map((p, i) => `attachment page ${i + 1} is page ${p}`).join('; ');
  return [
    `<course>${escapeSource(input.courseLabel)}</course>`,
    `<file name="${input.fileName.replace(/["<>]/g, '')}" pages="${input.totalPages}">`,
    `${what} of this file: ${order}.`,
    `Return exactly these page numbers: ${input.pages.join(', ')}.`,
    '</file>',
  ].join('\n');
}

function attachmentBlock(a: Attachment): Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam {
  const data = Buffer.from(a.bytes).toString('base64');
  if (a.kind === 'pdf') return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } };
  return { type: 'image', source: { type: 'base64', media_type: a.mediaType, data } };
}

/**
 * Transcribes the attached pages. Returns only the page numbers asked for; a page Claude
 * left out is missing from the map, and the caller retries it on its own.
 */
export async function transcribePages(deps: AiDeps, input: TranscribeInput): Promise<{ pages: Map<number, PageText>; model: string }> {
  const r = await callClaude(deps, {
    purpose: 'transcribe',
    clearance: input.clearance,
    userId: input.userId,
    requestRef: `document:${input.documentId}:pages:${input.pages.join(',')}`,
    system: TRANSCRIBE_SYSTEM,
    user: transcriptionUserTurn(input),
    attachments: [attachmentBlock(input.attachment)],
    schema: transcribeResult,
    // Dense handwritten pages run long; this leaves room for three of them.
    maxTokens: 24000,
    effort: 'low',
  });
  const wanted = new Set(input.pages);
  const pages = new Map<number, PageText>();
  for (const p of r.data.pages) {
    const n = Math.round(p.page);
    if (!wanted.has(n) || pages.has(n)) continue;
    pages.set(n, { markdown: p.markdown.trim(), blank: p.blank || !p.markdown.trim() });
  }
  if (!pages.size) throw new ClaudeError('Claude returned none of the pages asked for.');
  return { pages, model: r.model };
}
