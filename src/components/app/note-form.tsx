'use client';

import Link from 'next/link';
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { createNote } from '@/app/(app)/notes/actions';
import type { CourseLite } from '@/lib/db/queries';
import { selectClass } from '@/lib/ui';
import { FileDropArea, filesFromClipboard, useFileUploads } from './file-drop';
import { NothingNew } from './nothing-new';

// New note (SPEC 4.5): course, lecture date, optional title, and the paste area.
// The lecture date follows the course's most recent lecture day until Dylan sets it.

export function NoteForm({
  courses,
  initialCourse,
  defaultDates,
  today,
}: {
  courses: CourseLite[];
  initialCourse: string;
  /** Course id to its most recent lecture day (YYYY-MM-DD). */
  defaultDates: Record<string, string>;
  today: string;
}) {
  const router = useRouter();
  const [course, setCourse] = useState(initialCourse);
  const [date, setDate] = useState(defaultDates[initialCourse] ?? today);
  const [dateTouched, setDateTouched] = useState(false);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ id: string; title: string } | null>(null);
  const [nothingNew, setNothingNew] = useState<{ documentId: string; decision: string } | null>(null);
  const { uploads, addFiles } = useFileUploads({ courseId: course || null, purpose: 'note', lectureOn: date, noteTitle: title.trim() || null });
  const [isPending, startTransition] = useTransition();
  const area = useRef<HTMLTextAreaElement>(null);
  const picked = courses.find((c) => c.id === course);

  function pickCourse(id: string) {
    setCourse(id);
    if (!dateTouched) setDate(defaultDates[id] ?? today);
  }

  async function fromClipboard() {
    try {
      setText(await navigator.clipboard.readText());
      area.current?.focus();
    } catch {
      setError('The browser blocked clipboard access. Paste into the box instead.');
    }
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDuplicate(null);
    setNothingNew(null);
    if (!course) {
      setError('Pick a course.');
      return;
    }
    startTransition(async () => {
      const res = await createNote({ courseId: course, lectureOn: date, title: title.trim() || undefined, text });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (res.data.status === 'duplicate') {
        setDuplicate({ id: res.data.id, title: res.data.title });
        return;
      }
      if (res.data.status === 'nothing_new') {
        setNothingNew({ documentId: res.data.documentId, decision: res.data.decision });
        return;
      }
      toast.success(res.data.decision ? `Note saved: ${res.data.decision}` : 'Note saved');
      router.push(`/notes/${res.data.id}`);
    });
  }

  return (
    <form onSubmit={save} className="grid max-w-3xl gap-4">
      <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end">
        <div className="grid gap-1.5">
          <label htmlFor="note-course" className="text-sm font-semibold">
            Course
          </label>
          <select id="note-course" className={selectClass} value={course} onChange={(e) => pickCourse(e.target.value)} required>
            <option value="">Pick a course</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code}
                {c.ai_allowed ? '' : ' (AI off)'}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="note-date" className="text-sm font-semibold">
            Lecture date
          </label>
          <Input
            id="note-date"
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setDateTouched(true);
            }}
            required
            className="h-11 sm:h-9"
          />
        </div>
        <div className="col-span-2 grid gap-1.5 sm:min-w-64 sm:flex-1">
          <label htmlFor="note-title" className="text-sm font-semibold">
            Title <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <Input id="note-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className="h-11 sm:h-9" />
        </div>
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="note-text" className="text-sm font-semibold">
          Notes
        </label>
        <Textarea
          ref={area}
          id="note-text"
          rows={16}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const files = filesFromClipboard(e);
            if (!files.length) return;
            e.preventDefault();
            if (!course) setError('Pick a course first.');
            else void addFiles(files);
          }}
          placeholder="Paste today's lecture notes, or all of your running notes document: only what's new becomes the note. Markdown, LaTeX in $...$, and code blocks all work."
          className="min-h-72 font-serif text-[16px]"
        />
      </div>
      <div className="grid gap-1.5">
        <span className="text-sm font-semibold">Or add a file</span>
        <FileDropArea
          addFiles={addFiles}
          uploads={uploads}
          disabledReason={course ? null : 'Pick a course to add a PDF or photo of your notes.'}
          hint="Drop a PDF (a GoodNotes export or slides) or photos. Pages already stored from an earlier export are skipped."
        />
      </div>
      {picked ? (
        <p className="text-sm text-muted-foreground">
          {picked.ai_allowed
            ? `Saved exactly as written. ${picked.code} allows AI as a study aid, so Claude also makes a cleaned copy beside your original.`
            : `Saved exactly as written. ${picked.code} bans generative AI, so these notes are never sent to Claude.`}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-late">
          {error}
        </p>
      ) : null}
      {duplicate ? (
        <p role="status" className="text-sm">
          Already saved as{' '}
          <Link href={`/notes/${duplicate.id}`} className="text-link underline underline-offset-2">
            {duplicate.title}
          </Link>
          .
        </p>
      ) : null}
      {nothingNew ? <NothingNew documentId={nothingNew.documentId} decision={nothingNew.decision} /> : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={isPending} className="h-11 sm:h-9">
          {isPending ? 'Saving...' : 'Save note'}
        </Button>
        <Button type="button" variant="outline" onClick={fromClipboard} className="h-11 sm:hidden">
          Paste from clipboard
        </Button>
      </div>
    </form>
  );
}
