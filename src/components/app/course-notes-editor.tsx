'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { saveCourseNotes } from '@/app/(app)/actions';

/** The free-form notes field on a course Overview. */
export function CourseNotesEditor({ courseId, initial }: { courseId: string; initial: string }) {
  const [text, setText] = useState(initial);
  const [isPending, startTransition] = useTransition();
  const dirty = text !== initial;

  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await saveCourseNotes(courseId, text);
          if (result.ok) toast.success('Saved');
          else toast.error(result.error);
        });
      }}
    >
      <label htmlFor="course-notes" className="sr-only">
        Course notes
      </label>
      <Textarea id="course-notes" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="Anything worth remembering about this course." />
      <div>
        <Button type="submit" variant="outline" className="h-11 sm:h-9" disabled={!dirty || isPending}>
          Save notes
        </Button>
      </div>
    </form>
  );
}
