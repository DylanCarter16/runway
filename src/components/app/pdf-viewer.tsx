'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { ChevronLeftIcon, ChevronRightIcon, ListTreeIcon, MinusIcon, PlusIcon, SearchIcon } from 'lucide-react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { searchPages, viewerFileUrl, type PageHit } from '@/app/(app)/files/actions';
import { PDF_RANGE_OPTIONS, openCachedFile, rangeTransportFor, type FileLink } from '@/lib/files/pdf-cache';
import type { OutlineEntry } from '@/lib/files/outline';
import { cn } from '@/lib/utils';
import { MarkedSnippet } from './marked-snippet';

// The in-app PDF viewer (PHASES.md Phase 10, Task 3): one page at a time, page number input,
// fit width, fit page, and zoom steps, a selectable text layer, the stored outline, and search
// inside the document. pdf.js runs in a worker; react-pdf asks for the worker in this module.
// The file comes from the session cache by document id, never from a URL prop: a page refresh
// used to hand the viewer a new signed URL and react-pdf downloaded the whole PDF again.

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

type Zoom = 'width' | 'page' | number;
const MIN_SCALE = 0.25;
const MAX_SCALE = 4;

type Transport = InstanceType<typeof pdfjs.PDFDataRangeTransport>;

async function fileLink(documentId: string): Promise<FileLink> {
  const res = await viewerFileUrl(documentId);
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

/**
 * pdf.js's view of the cached file: a fresh range transport per load (pdf.js aborts it on
 * unmount), over bytes that stay in the session cache. Only the document id is a dependency.
 */
function useCachedPdf(documentId: string): { source: Transport | null; error: string | null } {
  const [state, setState] = useState<{ id: string; source: Transport | null; error: string | null }>({ id: documentId, source: null, error: null });
  useEffect(() => {
    let live = true;
    const fail = (e: unknown) => {
      if (live) setState({ id: documentId, source: null, error: e instanceof Error ? e.message : String(e) });
    };
    openCachedFile(documentId, fileLink)
      .then((file) => rangeTransportFor(pdfjs.PDFDataRangeTransport, file, fail))
      .then((source) => {
        if (live) setState({ id: documentId, source, error: null });
      }, fail);
    return () => {
      live = false;
    };
  }, [documentId]);
  return state.id === documentId ? state : { source: null, error: null };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The section the page is in: the last outline entry at or before it. */
function currentEntry(outline: OutlineEntry[], page: number): number {
  let at = -1;
  outline.forEach((e, i) => {
    if (e.page <= page) at = i;
  });
  return at;
}

export interface PdfViewerProps {
  documentId: string;
  title: string;
  pageCount: number | null;
  outline: OutlineEntry[];
  initialPage: number;
}

export default function PdfViewer({ documentId, title, pageCount, outline, initialPage }: PdfViewerProps) {
  const [numPages, setNumPages] = useState<number | null>(pageCount);
  const [page, setPage] = useState(initialPage);
  const [pageInput, setPageInput] = useState(String(initialPage));
  const [zoom, setZoom] = useState<Zoom>('width');
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<PageHit[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searched, setSearched] = useState('');
  const [isSearching, startSearch] = useTransition();
  const frame = useRef<HTMLDivElement>(null);
  const { source, error: fileError } = useCachedPdf(documentId);
  const file = useMemo(() => (source ? { range: source } : null), [source]);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: Math.max(240, window.innerHeight - el.getBoundingClientRect().top - 24) });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const goTo = useCallback(
    (n: number) => {
      const last = numPages ?? n;
      const next = Math.min(Math.max(1, Math.round(n)), last);
      setPage(next);
      setPageInput(String(next));
      const params = new URLSearchParams(window.location.search);
      params.set('page', String(next));
      window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
    },
    [numPages],
  );

  // Page width in CSS pixels for the zoom mode; pdf.js treats 1 PDF point as 1 CSS pixel at scale 1.
  const width = useMemo(() => {
    const avail = Math.max(120, box.w - 2);
    if (!size) return avail;
    if (zoom === 'width') return avail;
    if (zoom === 'page') return Math.min(avail, (box.h * size.w) / size.h);
    return size.w * zoom;
  }, [box, size, zoom]);
  const scale = size ? width / size.w : 1;

  function step(factor: number) {
    setZoom(Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(scale * factor * 100) / 100)));
  }

  function runSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    startSearch(async () => {
      const res = await searchPages({ q, documentId });
      setSearched(q);
      if (res.ok) {
        setHits(res.data);
        setSearchError(null);
      } else {
        setHits(null);
        setSearchError(res.error);
      }
    });
  }

  // Search words light up in the page's text layer. Text is escaped before marking.
  const words = useMemo(
    () =>
      searched
        .split(/\s+/)
        .map((w) => w.replace(/["()]/g, ''))
        .filter((w) => w.length >= 3 && !/^(or|and|not)$/i.test(w)),
    [searched],
  );
  const textRenderer = useCallback(
    ({ str }: { str: string }) => {
      const safe = escapeHtml(str);
      if (!words.length) return safe;
      return safe.replace(new RegExp(`(${words.map((w) => escapeRegex(escapeHtml(w))).join('|')})`, 'gi'), '<mark class="pdf-hit">$1</mark>');
    },
    [words],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)))) return;
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') goTo(page - 1);
      else if (e.key === 'ArrowRight' || e.key === 'PageDown') goTo(page + 1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goTo, page]);

  const active = currentEntry(outline, page);
  const outlineList = outline.length ? (
    <ol className="grid gap-0.5 text-sm">
      {outline.map((e, i) => (
        <li key={`${e.page}-${i}`}>
          <button
            type="button"
            onClick={() => {
              goTo(e.page);
              setOutlineOpen(false);
            }}
            aria-current={i === active ? 'location' : undefined}
            style={{ paddingLeft: `${(Math.min(e.level, 4) - 1) * 0.875 + 0.5}rem` }}
            className={cn(
              'grid min-h-11 w-full grid-cols-[1fr_auto] items-center gap-2 rounded-md pr-2 text-left hover:bg-[color-mix(in_oklab,var(--rule)_40%,transparent)] sm:min-h-8',
              i === active && 'bg-[color-mix(in_oklab,var(--tie)_25%,transparent)] font-semibold',
            )}
          >
            <span className="min-w-0 break-words">{e.title}</span>
            <span className="text-xs text-muted-foreground tabular">{e.page}</span>
          </button>
        </li>
      ))}
    </ol>
  ) : (
    <p className="text-sm text-muted-foreground">This file has no bookmarks, and no numbered headings were found in its text.</p>
  );

  return (
    <section aria-label={`${title}, PDF viewer`} className="grid gap-3">
      <form onSubmit={runSearch} className="flex gap-2" role="search">
        <label htmlFor="pdf-search" className="sr-only">
          Search this document
        </label>
        <Input id="pdf-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search this document" className="h-11 sm:h-9" />
        <Button type="submit" variant="outline" className="h-11 sm:h-9" disabled={isSearching}>
          <SearchIcon aria-hidden />
          {isSearching ? 'Searching' : 'Search'}
        </Button>
      </form>
      {searchError ? <p className="text-sm text-late">{searchError}</p> : null}
      {hits ? (
        hits.length ? (
          <div className="grid gap-1">
            <p className="text-sm text-muted-foreground">
              {hits.length === 50 ? 'The first 50 pages' : hits.length === 1 ? '1 page' : `${hits.length} pages`} match &quot;{searched}&quot;.
            </p>
            <ol className="max-h-72 divide-y divide-rule overflow-y-auto border-y border-rule text-sm" aria-label="Pages that match">
              {hits.map((h) => (
                <li key={h.page}>
                  <button type="button" onClick={() => goTo(h.page)} className="grid min-h-11 w-full gap-0.5 py-2 text-left hover:bg-[color-mix(in_oklab,var(--rule)_40%,transparent)]">
                    <span className="font-semibold">
                      Page {h.page}
                      {h.heading ? <span className="font-normal text-muted-foreground">, {h.heading}</span> : null}
                    </span>
                    <MarkedSnippet text={h.snippet} className="text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No page matches &quot;{searched}&quot;.</p>
        )
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-y border-rule py-2">
        <Button type="button" variant="outline" className="h-11 lg:hidden sm:h-9" onClick={() => setOutlineOpen(true)}>
          <ListTreeIcon aria-hidden />
          Contents
        </Button>
        <div className="flex items-center gap-1">
          <Button type="button" variant="outline" size="icon-lg" className="size-11 sm:size-9" onClick={() => goTo(page - 1)} disabled={page <= 1} aria-label="Previous page">
            <ChevronLeftIcon aria-hidden />
          </Button>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(pageInput);
              if (Number.isFinite(n)) goTo(n);
            }}
            className="flex items-center gap-1 text-sm"
          >
            <label htmlFor="pdf-page" className="sr-only">
              Page number
            </label>
            <Input
              id="pdf-page"
              inputMode="numeric"
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ''))}
              onBlur={() => setPageInput(String(page))}
              className="h-11 w-16 text-center tabular sm:h-9"
            />
            <span className="whitespace-nowrap text-muted-foreground tabular">of {numPages ?? '…'}</span>
          </form>
          <Button
            type="button"
            variant="outline"
            size="icon-lg"
            className="size-11 sm:size-9"
            onClick={() => goTo(page + 1)}
            disabled={numPages !== null && page >= numPages}
            aria-label="Next page"
          >
            <ChevronRightIcon aria-hidden />
          </Button>
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Zoom">
          <Button type="button" variant={zoom === 'width' ? 'default' : 'outline'} className="h-11 sm:h-9" aria-pressed={zoom === 'width'} onClick={() => setZoom('width')}>
            Fit width
          </Button>
          <Button type="button" variant={zoom === 'page' ? 'default' : 'outline'} className="h-11 sm:h-9" aria-pressed={zoom === 'page'} onClick={() => setZoom('page')}>
            Fit page
          </Button>
          <Button type="button" variant="outline" size="icon-lg" className="size-11 sm:size-9" onClick={() => step(0.8)} disabled={scale <= MIN_SCALE} aria-label="Zoom out">
            <MinusIcon aria-hidden />
          </Button>
          <span className="w-12 text-center text-sm tabular" aria-live="polite">
            {Math.round(scale * 100)}%
          </span>
          <Button type="button" variant="outline" size="icon-lg" className="size-11 sm:size-9" onClick={() => step(1.25)} disabled={scale >= MAX_SCALE} aria-label="Zoom in">
            <PlusIcon aria-hidden />
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <nav aria-label="Contents" className="hidden max-h-[80vh] overflow-y-auto lg:block">
          <h3 className="pb-2 text-sm font-semibold">Contents</h3>
          {outlineList}
        </nav>
        <div ref={frame} className="min-w-0 overflow-auto rounded-md border border-rule bg-sheet" data-testid="pdf-frame">
          {fileError ? <p className="p-4 text-sm text-late">{fileError}</p> : null}
          <Document
            file={file}
            options={PDF_RANGE_OPTIONS}
            suspense={false}
            onLoadSuccess={(pdf) => {
              setNumPages(pdf.numPages);
              if (page > pdf.numPages) goTo(pdf.numPages);
            }}
            onItemClick={({ pageNumber }) => goTo(pageNumber)}
            loading={<p className="p-4 text-sm text-muted-foreground">Loading the PDF…</p>}
            noData={fileError ? null : <p className="p-4 text-sm text-muted-foreground">Loading the PDF…</p>}
            error={<p className="p-4 text-sm text-late">The PDF could not be opened here. Use Open the original instead.</p>}
            externalLinkTarget="_blank"
            externalLinkRel="noopener noreferrer"
          >
            <Page
              key={page}
              pageNumber={page}
              width={Math.round(width)}
              className="mx-auto w-fit"
              onLoadSuccess={(p) => setSize({ w: p.originalWidth, h: p.originalHeight })}
              customTextRenderer={textRenderer}
              loading={<p className="p-4 text-sm text-muted-foreground">Loading page {page}…</p>}
              error={<p className="p-4 text-sm text-late">Page {page} could not be drawn.</p>}
            />
          </Document>
        </div>
      </div>

      <Sheet open={outlineOpen} onOpenChange={setOutlineOpen}>
        <SheetContent side="left" className="w-full overflow-y-auto sm:max-w-sm">
          <SheetHeader>
            <SheetTitle>Contents</SheetTitle>
            <SheetDescription>{title}</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-6">{outlineList}</div>
        </SheetContent>
      </Sheet>
    </section>
  );
}
