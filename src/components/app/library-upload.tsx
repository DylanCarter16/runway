"use client";

import { useState } from "react";
import type { Course } from "@/lib/db/queries";
import { selectClass } from "@/lib/ui";
import { FileDrop } from "./file-drop";

/** Adding files from the Library: pick the course (optional, except for textbooks), then drop. */
export function LibraryUpload({
  courses,
}: {
  courses: Pick<Course, "id" | "code" | "ai_allowed">[];
}) {
  const [courseId, setCourseId] = useState("");
  const [textbook, setTextbook] = useState(false);
  const course = courses.find((c) => c.id === courseId) ?? null;
  return (
    <section aria-labelledby="library-upload" className="grid gap-3">
      <h3 id="library-upload" className="text-base font-semibold">
        Add files
      </h3>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1.5 text-sm">
          <span className="font-semibold">Course</span>
          <select
            className={selectClass}
            value={courseId}
            onChange={(e) => setCourseId(e.target.value)}
          >
            <option value="">No course</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
          <input
            type="checkbox"
            className="size-4 accent-(--ink)"
            checked={textbook}
            onChange={(e) => setTextbook(e.target.checked)}
          />
          It&apos;s a textbook
        </label>
      </div>
      <FileDrop
        options={{
          courseId: course?.id ?? null,
          purpose: textbook ? "textbook" : "library",
        }}
        disabledReason={
          textbook && !course ? "Pick the course this textbook is for." : null
        }
        hint={
          textbook
            ? "Drop the textbook PDF (up to 50 MB). Pages with text are indexed for search; nothing is sent to AI."
            : course?.ai_allowed
              ? `Drop PDFs, images, or screenshots for ${course.code}. Scanned pages are transcribed by Claude.`
              : "Drop PDFs, images, or screenshots. Only PDF text is read; scans and photos are stored as they are."
        }
      />
    </section>
  );
}
