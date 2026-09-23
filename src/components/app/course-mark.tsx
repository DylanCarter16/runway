import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';

export interface CourseColor {
  color: string;
  color_dark: string;
}

/** Inline style that sets a course's light and dark marks; pair it with data-course. */
export function courseStyle(course: CourseColor | null | undefined): CSSProperties {
  if (!course) return {};
  return { '--course-l': course.color, '--course-d': course.color_dark } as CSSProperties;
}

/** An 8px dot in the course color. */
export function CourseDot({ course, className }: { course: CourseColor | null | undefined; className?: string }) {
  return (
    <span
      aria-hidden
      data-course=""
      style={courseStyle(course)}
      className={cn('inline-block size-2 shrink-0 rounded-full bg-(--course)', className)}
    />
  );
}

/** Chip with a course dot and code on a 12% tint. */
export function CourseChip({
  course,
  className,
}: {
  course: (CourseColor & { code: string }) | null | undefined;
  className?: string;
}) {
  if (!course) return <span className={cn('text-sm text-muted-foreground', className)}>No course</span>;
  return (
    <span
      data-course=""
      style={courseStyle(course)}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md bg-[color-mix(in_oklab,var(--course)_12%,transparent)] px-2 py-0.5 text-sm whitespace-nowrap',
        className,
      )}
    >
      <CourseDot course={course} />
      {course.code}
    </span>
  );
}
