// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearPdfCache } from '@/lib/files/pdf-cache';

// Storage egress regression (2026-10-20), at the component: one document render is one
// fetch, not N. The Library page used to pass the viewer a freshly signed URL on every
// render and refresh every 4 seconds while a file was read; react-pdf saw a new `file` each
// time and downloaded the whole PDF again. Here the real PdfViewer is re-rendered the way
// router.refresh() does, paged, zoomed, searched, and remounted; react-pdf is a stand-in
// that asks for the first bytes of each `file` it is given, like pdf.js does on load.

const h = vi.hoisted(() => ({
  links: 0,
  loads: [] as unknown[],
  received: [] as number[],
}));

vi.mock('@/app/(app)/files/actions', () => ({
  viewerFileUrl: vi.fn(async () => ({ ok: true, data: { url: `https://storage.example/object/sign/library/doc.pdf?token=t${++h.links}`, size: 1_000_000 } })),
  searchPages: vi.fn(async () => ({ ok: true, data: [] })),
}));

vi.mock('react-pdf', () => {
  class PDFDataRangeTransport {
    constructor(
      public length: number,
      public initialData: unknown,
    ) {}
    requestDataRange() {}
    onDataRange(_begin: number, chunk: Uint8Array) {
      h.received.push(chunk.length);
    }
    abort() {}
  }
  function Document({ file, children, onLoadSuccess, noData }: { file: { range: PDFDataRangeTransport } | null; children: React.ReactNode; onLoadSuccess?: (pdf: { numPages: number }) => void; noData?: React.ReactNode }) {
    useEffect(() => {
      if (!file) return;
      h.loads.push(file);
      (file.range.requestDataRange as (begin: number, end: number) => void)(0, 65_536); // pdf.js reads the header first
      onLoadSuccess?.({ numPages: 50 });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [file]);
    return file ? <div data-testid="pdf-document">{children}</div> : <>{noData}</>;
  }
  const Page = ({ pageNumber, width }: { pageNumber: number; width: number }) => (
    <div data-testid="pdf-page">
      page {pageNumber} at {width}
    </div>
  );
  return { pdfjs: { GlobalWorkerOptions: {}, PDFDataRangeTransport }, Document, Page };
});

const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
  const m = /^bytes=(\d+)-(\d+)$/.exec((init?.headers as Record<string, string>).Range)!;
  return new Response(new Uint8Array(Number(m[2]) - Number(m[1]) + 1), { status: 206 });
});

const { default: PdfViewer } = await import('@/components/app/pdf-viewer');
const { viewerFileUrl } = await import('@/app/(app)/files/actions');

/** What the server sends on each render: new objects every time, as after router.refresh(). */
const props = (documentId = '5f0c1a52-6a43-4c38-9a4e-7a1b2f9d3c11') => ({
  documentId,
  title: 'Patterson and Hennessy',
  pageCount: 50,
  outline: [{ title: '4 The Processor', page: 12, level: 1 }],
  initialPage: 1,
});

beforeEach(() => {
  clearPdfCache();
  h.links = 0;
  h.loads.length = 0;
  h.received.length = 0;
  fetchSpy.mockClear();
  vi.mocked(viewerFileUrl).mockClear();
  vi.stubGlobal('fetch', fetchSpy);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PdfViewer storage reads', () => {
  it('one document render triggers one fetch, not N: refreshes, page jumps, zoom, search keystrokes, and a remount add none', async () => {
    const view = render(<PdfViewer {...props()} />);
    await waitFor(() => expect(h.received).toHaveLength(1));
    expect(viewerFileUrl).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][1]).toEqual({ headers: { Range: 'bytes=0-131071' } }); // one range, not the file

    // 20 refreshes while the file is being read: the server re-renders the page each time.
    for (let i = 0; i < 20; i++) view.rerender(<PdfViewer {...props()} />);
    // Page jumps, zoom, and typing in the search box.
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fit page' }));
    for (const q of ['p', 'pi', 'pip', 'pipe']) fireEvent.change(screen.getByPlaceholderText('Search this document'), { target: { value: q } });
    await act(async () => {});
    expect(screen.getByTestId('pdf-page').textContent).toContain('page 6');
    expect(h.loads).toHaveLength(1);

    // Leave the page and come back (client navigation): new pdf.js load, same bytes.
    view.unmount();
    render(<PdfViewer {...props()} />);
    await waitFor(() => expect(h.received).toHaveLength(2));
    expect(h.loads).toHaveLength(2);

    expect(viewerFileUrl).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('another file gets its own link and fetch', async () => {
    render(<PdfViewer {...props()} />);
    await waitFor(() => expect(h.received).toHaveLength(1));
    cleanup();
    render(<PdfViewer {...props('0b6f6b7e-31c5-4b7e-8f0e-4f1d6d7c2a90')} />);
    await waitFor(() => expect(h.received).toHaveLength(2));
    expect(viewerFileUrl).toHaveBeenCalledTimes(2);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
