'use client';

import Link from 'next/link';
import { useState } from 'react';
import { formatBytes } from '@/lib/files/constants';
import { FileDrop } from './file-drop';

export interface CourseFileRow {
  id: string;
  kind: string;
  title: string;
  file_name: string | null;
  file_size: number | null;
  summary: string | null;
  page_count: number | null;
}

/**
 * Files on a course's Resources tab: textbooks first, then uploads, each linking to its Library
 * page. Adding a textbook stores it and lists it; chapters are read on request from its page.
 */
export function CourseFiles({ courseId, courseCode, aiOn, files }: { courseId: string; courseCode: string; aiOn: boolean; files: CourseFileRow[] }) {
  const [textbook, setTextbook] = useState(false);
  const books = files.filter((f) => f.kind === 'textbook');
  const uploads = files.filter((f) => f.kind !== 'textbook');
  return (
    <section aria-labelledby="course-files" className="grid gap-3">
      <h3 id="course-files" className="text-lg font-semibold">
        Files
      </h3>
      {[
        { label: 'Textbooks', rows: books },
        { label: 'Uploads', rows: uploads },
      ].map(({ label, rows }) =>
        rows.length ? (
          <div key={label} className="grid gap-1">
            <h4 className="text-sm font-semibold text-muted-foreground">{label}</h4>
            <ul className="divide-y divide-rule border-y border-rule text-sm">
              {rows.map((f) => (
                <li key={f.id} className="grid gap-0.5 py-2">
                  <Link href={`/library/${f.id}`} className="min-w-0 truncate font-semibold underline-offset-2 hover:underline" title={f.title}>
                    {f.title}
                  </Link>
                  <span className="text-muted-foreground">
                    {[f.file_name !== f.title ? f.file_name : null, f.file_size ? formatBytes(f.file_size) : null, f.page_count ? `${f.page_count} pages` : null].filter(Boolean).join(', ')}
                    {f.summary ? `. ${f.summary}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
      <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-8">
        <input type="checkbox" className="size-4 accent-(--ink)" checked={textbook} onChange={(e) => setTextbook(e.target.checked)} />
        It&apos;s a textbook: store and list it, and read chapters only when I ask
      </label>
      <FileDrop
        options={{ courseId, purpose: textbook ? 'textbook' : 'library' }}
        hint={
          textbook
            ? 'Drop the textbook PDF (up to 50 MB).'
            : aiOn
              ? `Drop PDFs, images, or screenshots for ${courseCode}. Scanned pages are transcribed by Claude.`
              : `Drop PDFs, images, or screenshots for ${courseCode}. AI is off, so only PDF text is read; scans and photos are stored as they are.`
        }
      />
    </section>
  );
}
