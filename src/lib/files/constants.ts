// Limits for uploaded files (PHASES.md Phase 9). Storage caps come from the Supabase free plan;
// request caps come from the Claude API (5 MB per image, 32 MB per request).

export const LIBRARY_BUCKET = 'library';

/** The bucket's file_size_limit (Supabase free plan maximum). */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** Claude takes images up to 5 MB each. */
export const MAX_VISION_IMAGE_BYTES = 5 * 1024 * 1024;

/** A page range sent as one PDF stays well under the 32 MB request limit (base64 adds a third). */
export const MAX_VISION_PDF_BYTES = 20 * 1024 * 1024;

/** Pages per transcription call. Three handwritten pages fit comfortably in one job step. */
export const PAGES_PER_CALL = 3;

/** A PDF page with at least this many letters or digits has a usable text layer. */
export const MIN_TEXT_CHARS = 25;

export const PDF_TYPE = 'application/pdf';
export const VISION_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export const UPLOAD_TYPES = [PDF_TYPE, ...VISION_IMAGE_TYPES, 'image/heic', 'image/heif'] as const;

export type UploadPurpose = 'library' | 'note' | 'textbook';

export function isVisionImageType(type: string): type is (typeof VISION_IMAGE_TYPES)[number] {
  return (VISION_IMAGE_TYPES as readonly string[]).includes(type);
}

/** `<user_id>/<document_id>/<file name>`, the name made safe for a storage key. */
export function storagePath(userId: string, documentId: string, fileName: string): string {
  const safe = fileName
    .normalize('NFKD')
    .replace(/[^\w.\- ]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/^[.-]+/, '')
    .slice(0, 120);
  return `${userId}/${documentId}/${safe || 'file'}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
