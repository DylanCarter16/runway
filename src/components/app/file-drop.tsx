'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { finishUpload, getFileStatus, startUpload, type UploadInput } from '@/app/(app)/files/actions';
import { keepWholePaste } from '@/app/(app)/notes/actions';
import { getBrowserClient } from '@/lib/db/browser';
import { LIBRARY_BUCKET, MAX_UPLOAD_BYTES, UPLOAD_TYPES, formatBytes, type UploadPurpose } from '@/lib/files/constants';
import { cn } from '@/lib/utils';

// Files anywhere Dylan can paste (PHASES.md Phase 9): drop, pick, or paste PDFs, images, and
// screenshots. The file goes straight from the browser to the private library bucket; the
// server records it and reads it in the background, and this list follows along.

type UploadState = 'checking' | 'uploading' | 'reading' | 'done' | 'duplicate' | 'error';

interface Upload {
  key: string;
  name: string;
  size: number;
  state: UploadState;
  message: string | null;
  href: string | null;
  noteId: string | null;
  documentId: string | null;
  nothingNew: boolean;
}

export interface UploadOptions {
  courseId: string | null;
  purpose: UploadPurpose;
  lectureOn?: string | null;
  noteTitle?: string | null;
}

const EXT_TYPES: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', heif: 'image/heif' };

function typeOf(file: File): string {
  if (file.type) return file.type;
  return EXT_TYPES[file.name.split('.').pop()?.toLowerCase() ?? ''] ?? '';
}

/** Clipboard screenshots arrive as "image.png"; give them a name that says when. */
function named(file: File): File {
  if (!/^image\.(png|jpe?g|gif|webp)$/i.test(file.name)) return file;
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}.${pad(now.getMinutes())}`;
  return new File([file], `Screenshot ${stamp}.${file.name.split('.').pop()}`, { type: file.type });
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function useFileUploads(options: UploadOptions) {
  const router = useRouter();
  const [uploads, setUploads] = useState<Upload[]>([]);
  const timers = useRef<number[]>([]);
  const opts = useRef(options);
  useEffect(() => {
    opts.current = options;
  });
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const patch = useCallback((key: string, p: Partial<Upload>) => setUploads((list) => list.map((u) => (u.key === key ? { ...u, ...p } : u))), []);

  const follow = useCallback(
    async (key: string, documentId: string) => {
      for (let tries = 0; tries < 200; tries++) {
        // Timers are cleared on unmount, which leaves this loop waiting for good.
        await new Promise<void>((resolve) => timers.current.push(window.setTimeout(resolve, tries < 10 ? 2000 : 5000)));
        const res = await getFileStatus(documentId);
        if (res.ok && res.data.done) {
          patch(key, { state: 'done', message: res.data.summary, noteId: res.data.noteId, nothingNew: res.data.nothingNew });
          router.refresh();
          return;
        }
        if (res.ok && res.data.summary) patch(key, { message: res.data.summary });
      }
      patch(key, { message: 'Still reading. The Library shows progress.' });
    },
    [patch, router],
  );

  const addFiles = useCallback(
    async (files: File[]) => {
      for (const raw of files) {
        const file = named(raw);
        const key = `${file.name}-${file.size}-${Date.now()}-${Math.random()}`;
        const type = typeOf(file);
        setUploads((list) => [...list, { key, name: file.name, size: file.size, state: 'checking', message: null, href: null, noteId: null, documentId: null, nothingNew: false }]);
        if (!(UPLOAD_TYPES as readonly string[]).includes(type)) {
          patch(key, { state: 'error', message: 'Only PDFs and images (PNG, JPEG, WebP, GIF, HEIC) can be added.' });
          continue;
        }
        if (file.size > MAX_UPLOAD_BYTES) {
          patch(key, { state: 'error', message: `This file is ${formatBytes(file.size)}. Files over 50 MB can't be stored on the free plan.` });
          continue;
        }
        try {
          const o = opts.current;
          const input: UploadInput = {
            name: file.name,
            size: file.size,
            type: type as UploadInput['type'],
            sha256: await sha256(file),
            courseId: o.courseId,
            purpose: o.purpose,
            lectureOn: o.lectureOn ?? null,
            noteTitle: o.noteTitle ?? null,
          };
          const start = await startUpload(input);
          if (!start.ok) {
            patch(key, { state: 'error', message: start.error });
            continue;
          }
          if (start.data.status === 'duplicate') {
            patch(key, { state: 'duplicate', href: start.data.href, message: `Already stored as ${start.data.label}. Nothing new was created.` });
            continue;
          }
          patch(key, { state: 'uploading' });
          const { error } = await getBrowserClient().storage.from(LIBRARY_BUCKET).upload(start.data.path, file, { contentType: type, upsert: false });
          if (error) {
            patch(key, { state: 'error', message: `Upload failed: ${error.message}` });
            continue;
          }
          const done = await finishUpload({ ...input, documentId: start.data.documentId, path: start.data.path });
          if (!done.ok) {
            patch(key, { state: 'error', message: done.error });
            continue;
          }
          patch(key, { state: 'reading', href: done.data.href, documentId: done.data.documentId, message: 'Stored. Reading it now...' });
          void follow(key, done.data.documentId);
        } catch (e) {
          patch(key, { state: 'error', message: e instanceof Error ? e.message : 'Upload failed.' });
        }
      }
    },
    [follow, patch],
  );

  return { uploads, addFiles };
}

/** Files from a paste event (screenshots, copied files), or none. */
export function filesFromClipboard(e: React.ClipboardEvent): File[] {
  return [...(e.clipboardData?.files ?? [])];
}

export function UploadList({ uploads }: { uploads: Upload[] }) {
  const router = useRouter();
  if (!uploads.length) return null;
  return (
    <ul aria-live="polite" className="grid gap-2 text-sm">
      {uploads.map((u) => (
        <li key={u.key} className="grid gap-0.5 rounded-md border border-rule bg-sheet px-3 py-2">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <span className="min-w-0 truncate font-semibold" title={u.name}>
              {u.name}
            </span>
            <span className="text-muted-foreground">{formatBytes(u.size)}</span>
            <span className={cn('ml-auto', u.state === 'error' ? 'text-late' : 'text-muted-foreground')}>
              {{ checking: 'Checking', uploading: 'Uploading', reading: 'Reading', done: 'Done', duplicate: 'Already stored', error: 'Not added' }[u.state]}
            </span>
          </div>
          {u.message ? <p className={u.state === 'error' ? 'text-late' : 'text-muted-foreground'}>{u.message}</p> : null}
          <div className="flex flex-wrap gap-x-4">
            {u.noteId ? (
              <Link href={`/notes/${u.noteId}`} className="text-link underline underline-offset-2">
                Open note
              </Link>
            ) : null}
            {u.href ? (
              <Link href={u.href} className="text-link underline underline-offset-2">
                Open in Library
              </Link>
            ) : null}
            {u.nothingNew && u.documentId ? (
              <button
                type="button"
                className="text-link underline underline-offset-2"
                onClick={async () => {
                  const res = await keepWholePaste({ documentId: u.documentId! });
                  if (!res.ok) toast.error(res.error);
                  else router.push(`/notes/${res.data.id}`);
                }}
              >
                Keep the whole file as one note
              </button>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** A drop area with a file picker. Pasting a screenshot works wherever the page listens (see PasteBox). */
export function FileDrop({ options, hint, disabledReason }: { options: UploadOptions; hint?: string; disabledReason?: string | null }) {
  const { uploads, addFiles } = useFileUploads(options);
  return <FileDropArea addFiles={addFiles} uploads={uploads} hint={hint} disabledReason={disabledReason} />;
}

export function FileDropArea({
  addFiles,
  uploads,
  hint,
  disabledReason,
}: {
  addFiles: (files: File[]) => void;
  uploads: Upload[];
  hint?: string;
  disabledReason?: string | null;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const disabled = Boolean(disabledReason);
  return (
    <div className="grid gap-2">
      <div
        onDragOver={(e) => {
          if (disabled) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!disabled) addFiles([...e.dataTransfer.files]);
        }}
        className={cn(
          'flex flex-wrap items-center gap-3 rounded-md border border-dashed px-3 py-3 text-sm',
          over ? 'border-ink bg-accent-soft' : 'border-rule',
          disabled && 'opacity-60',
        )}
      >
        <Button type="button" variant="outline" className="h-11 sm:h-9" disabled={disabled} onClick={() => input.current?.click()}>
          Add files
        </Button>
        <span className="min-w-0 flex-1 text-muted-foreground">
          {disabledReason ?? hint ?? 'Drop PDFs, images, or screenshots here, or paste a screenshot.'}
        </span>
        <input
          ref={input}
          type="file"
          multiple
          accept="application/pdf,image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif,.heic,.heif"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            addFiles([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
      </div>
      <UploadList uploads={uploads} />
    </div>
  );
}
