import { Markdown } from '@/components/app/markdown';
import type { Tables } from '@/lib/db/types';
import { formatBytes } from '@/lib/files/constants';
import type { FileMeta } from '@/lib/files/process';
import type { createClient } from '@/lib/db/server';
import { ExtractPagesForm, RefreshWhileReading, RetryPagesButton } from './file-actions';
import { PdfViewerLoader } from './pdf-viewer-loader';

// An uploaded file on its Library page: what it is, a link to the original, what was read,
// and each page's text (or why a page was skipped). PDFs open in the viewer (Phase 10), so
// only pages Claude transcribed, and pages still waiting or failed, are listed below it.

const PDF_LISTED = ['pending', 'failed'];

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Page = Pick<Tables<'document_pages'>, 'page' | 'status' | 'method' | 'text' | 'reason'>;

const METHOD_LABEL: Record<string, string> = { pdf_text: 'from the PDF text', vision: 'transcribed by Claude' };

export async function FileSection({
  supabase,
  doc,
  aiOn,
  initialPage,
}: {
  supabase: Supabase;
  doc: Pick<Tables<'documents'>, 'id' | 'kind' | 'title' | 'storage_path' | 'file_name' | 'file_size' | 'file_type' | 'meta'>;
  aiOn: boolean;
  /** The page the viewer opens on (?page= from search results). */
  initialPage?: number;
}) {
  const meta = (doc.meta ?? {}) as FileMeta;
  const isPdf = doc.file_type === 'application/pdf';
  // A book can have hundreds of pages: for PDFs, only transcribed pages bring their text.
  // No signed URL here: this renders on every refresh. The original link signs when clicked,
  // and the viewer gets its link once per session (src/lib/files/pdf-cache.ts).
  const [{ data: pages }, { data: texts }] = await Promise.all([
    isPdf
      ? supabase.from('document_pages').select('page, status, method, reason').eq('document_id', doc.id).order('page')
      : supabase.from('document_pages').select('page, status, method, text, reason').eq('document_id', doc.id).order('page'),
    isPdf
      ? supabase.from('document_pages').select('page, text').eq('document_id', doc.id).eq('method', 'vision').order('page')
      : Promise.resolve({ data: [] as { page: number; text: string | null }[] }),
  ]);
  const textByPage = new Map((texts ?? []).map((t) => [t.page, t.text]));
  const rows: Page[] = (pages ?? []).map((r) => ({ ...r, text: ('text' in r ? (r.text as string | null) : null) ?? textByPage.get(r.page) ?? null }));
  const reading = meta.status === 'queued' || meta.status === 'reading';
  const failed = rows.filter((r) => r.status === 'failed').length;
  const notRequested = rows.filter((r) => r.status === 'not_requested').length;
  const shown = rows.filter((r) => (isPdf ? r.method === 'vision' || PDF_LISTED.includes(r.status) : r.status !== 'not_requested'));

  return (
    <section className="grid gap-4">
      <RefreshWhileReading documentIds={[doc.id]} active={reading} />
      <div className="grid gap-1 text-sm">
        <h3 className="text-base font-semibold">File</h3>
        <p>
          {doc.file_name} <span className="text-muted-foreground">({[doc.file_type, doc.file_size ? formatBytes(doc.file_size) : null, meta.page_count ? `${meta.page_count} pages` : null].filter(Boolean).join(', ')})</span>
        </p>
        <p>
          <a href={`/api/files/${doc.id}/original`} target="_blank" rel="noopener noreferrer" className="text-link underline underline-offset-2">
            Open the original
          </a>{' '}
          <span className="text-muted-foreground">(stored exactly as uploaded)</span>
        </p>
        <p className={reading ? 'text-muted-foreground' : undefined}>{reading ? `Reading it now. ${meta.summary ?? ''}` : (meta.summary ?? 'Not read yet.')}</p>
        {meta.note_id ? (
          <p>
            <a href={`/notes/${meta.note_id}`} className="text-link underline underline-offset-2">
              Open the note made from this file
            </a>
          </p>
        ) : null}
        {meta.note_outcome === 'nothing_new' ? <p className="text-muted-foreground">Every page was already stored, so no note was made.</p> : null}
        {failed && !reading ? (
          <div className="pt-1">
            <RetryPagesButton documentId={doc.id} count={failed} />
          </div>
        ) : null}
      </div>

      {isPdf && notRequested && !reading ? <ExtractPagesForm documentId={doc.id} pageCount={meta.page_count ?? rows.length} aiOn={aiOn} /> : null}

      {isPdf ? (
        <PdfViewerLoader
          documentId={doc.id}
          title={doc.title}
          pageCount={meta.page_count ?? null}
          outline={meta.outline ?? []}
          initialPage={Math.max(1, Math.min(initialPage ?? 1, meta.page_count ?? Number.MAX_SAFE_INTEGER))}
        />
      ) : null}

      {shown.length ? (
        <div className="grid gap-3">
          <h3 className="text-base font-semibold">{shown.length === 1 && rows.length === 1 ? 'Text' : isPdf ? 'Pages Claude read, and pages still waiting' : 'Pages'}</h3>
          {notRequested && !isPdf ? <p className="text-sm text-muted-foreground">{notRequested} pages are stored but not read. Use Extract pages to read a chapter.</p> : null}
          <ol className="grid gap-4">
            {shown.map((r) => (
              <li key={r.page} className="grid gap-1 border-t border-rule pt-3">
                <p className="text-sm text-muted-foreground">
                  {rows.length > 1 ? `Page ${r.page}` : 'Page'}
                  {r.status === 'done' && r.method ? `, ${METHOD_LABEL[r.method]}` : ''}
                  {r.status === 'already_stored' ? ', already stored from an earlier upload' : ''}
                  {r.status === 'pending' ? ', waiting to be read' : ''}
                  {(r.status === 'skipped' || r.status === 'failed') && r.reason ? `: ${r.reason}` : ''}
                  {r.status === 'done' && r.reason ? ` (${r.reason})` : ''}
                </p>
                {r.text && (r.status === 'done' || r.status === 'already_stored') ? <Markdown className="max-w-[68ch]">{r.text}</Markdown> : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
