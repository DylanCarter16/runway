'use client';

import dynamic from 'next/dynamic';
import type { PdfViewerProps } from './pdf-viewer';

// pdf.js needs the browser (canvas, workers), so the viewer never renders on the server.
const PdfViewer = dynamic(() => import('./pdf-viewer'), {
  ssr: false,
  loading: () => <p className="text-sm text-muted-foreground">Loading the viewer…</p>,
});

export function PdfViewerLoader(props: PdfViewerProps) {
  return <PdfViewer {...props} />;
}
