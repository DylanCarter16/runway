import { CourseNotesEditor } from '@/components/app/course-notes-editor';
import { ItemRow, type RowItem } from '@/components/app/item-row';
import { OpenItemButton } from '@/components/app/quick-actions';
import type { Course } from '@/lib/db/queries';
import { getAppContext } from '@/lib/db/queries';
import { ASSESSMENT_KINDS, EXAM_KINDS, ROW_FIELDS } from '@/lib/items/labels';
import { effectiveDue } from '@/lib/items/runway';
import { formatCountdown, formatWhen } from '@/lib/time';

interface Meeting {
  component: string;
  section: string;
  days: string[];
  start: string;
  end: string;
  location: string | null;
  instructor: string | null;
  starts_on: string;
  ends_on: string;
}

function clock(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2">
      <h3 className="text-base font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function Policy({ title, text }: { title: string; text: string | null }) {
  return (
    <Section title={title}>
      <p className="text-sm text-muted-foreground">{text ?? 'Not recorded yet. Paste the outline in Inbox to fill this in.'}</p>
    </Section>
  );
}

export async function CourseOverview({ course }: { course: Course }) {
  const { supabase } = await getAppContext();
  const now = new Date();
  const { data } = await supabase.from('items').select(ROW_FIELDS).eq('course_id', course.id).eq('state', 'active').order('due_at', { nullsFirst: false });
  const items = (data ?? []) as (RowItem & { weight_percent: number | null })[];

  const upcoming = items.filter((i) => {
    const due = effectiveDue(i);
    return due && due > now && i.kind !== 'break';
  });
  const nextThree = upcoming.slice(0, 3);
  const nextExam = upcoming.find((i) => EXAM_KINDS.includes(i.kind as never));
  const assessments = items.filter((i) => ASSESSMENT_KINDS.includes(i.kind as never));
  const undated = assessments.filter((i) => !i.due_at && !i.starts_at);

  const meetings = (course.meetings as unknown as Meeting[]) ?? [];
  const staff = (course.staff as unknown as { name: string; role: string; email: string | null; office: string | null; notes: string | null }[]) ?? [];
  const hours = (course.office_hours as unknown as { who: string; when: string; where: string | null }[]) ?? [];
  const checklist = (course.checklist as unknown as string[]) ?? [];

  return (
    <div className="grid gap-8 lg:grid-cols-[3fr_2fr]">
      <div className="grid content-start gap-8">
        <Section title="Next up">
          {nextThree.length ? (
            <ul>
              {nextThree.map((i) => (
                <ItemRow key={i.id} item={i} now={now} showDate />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing coming up for {course.code}.</p>
          )}
        </Section>

        <Section title="Next exam">
          {nextExam ? (
            <p className="text-sm tabular">
              <OpenItemButton id={nextExam.id} className="font-semibold text-tie underline-offset-2 hover:underline">
                {nextExam.title}
              </OpenItemButton>
              , {formatWhen(new Date(nextExam.due_at ?? nextExam.starts_at!), nextExam.time_known)},{' '}
              {formatCountdown(new Date(nextExam.due_at ?? nextExam.starts_at!), nextExam.time_known, now)}
              <span className="block text-muted-foreground">
                {nextExam.location ? `Room ${nextExam.location}` : 'Room not posted yet'}
                {', '}
                {nextExam.seat ? `seat ${nextExam.seat}` : 'seat appears in Odyssey a few days before'}
              </span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No exam scheduled yet.</p>
          )}
        </Section>

        <Section title="Coverage">
          <details className="group">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 text-sm">
              <span className="font-semibold tabular">
                {assessments.length - undated.length} of {assessments.length} assessments dated
              </span>
              <span
                role="img"
                aria-label={`${assessments.length - undated.length} of ${assessments.length} assessments dated`}
                className="relative h-1 w-32 rounded-full bg-rule"
              >
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-ink"
                  style={{ width: `${assessments.length ? ((assessments.length - undated.length) / assessments.length) * 100 : 0}%` }}
                />
              </span>
              {undated.length ? <span className="text-tie group-open:hidden">Show undated</span> : null}
            </summary>
            {undated.length ? (
              <ul className="mt-2 grid gap-1 text-sm">
                {undated.map((i) => (
                  <li key={i.id}>
                    <OpenItemButton id={i.id} className="min-h-11 text-tie underline-offset-2 hover:underline">
                      {i.title}
                    </OpenItemButton>
                    {i.flags.includes('date_tba') ? <span className="text-muted-foreground">, date TBA</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">Every assessment has a date.</p>
            )}
          </details>
        </Section>

        <Section title="Meeting times">
          {meetings.length ? (
            <ul className="divide-y divide-rule text-sm">
              {meetings.map((m, i) => (
                <li key={i} className="py-2 tabular">
                  <span className="font-semibold">
                    {m.component} {m.section}
                  </span>
                  , {m.starts_on === m.ends_on ? m.starts_on : m.days.join(' ')}, {clock(m.start)} to {clock(m.end)}
                  {m.location ? `, ${m.location}` : ', room in Odyssey'}
                  {m.instructor ? <span className="block text-muted-foreground">{m.instructor}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Paste your Quest schedule in Inbox to add meeting times.</p>
          )}
        </Section>

        <Section title="Notes">
          <CourseNotesEditor courseId={course.id} initial={course.info_notes ?? ''} />
        </Section>
      </div>

      <div className="grid content-start gap-8">
        <Policy title="Late policy" text={course.late_policy} />
        <Policy title="Remark policy" text={course.remark_policy} />
        <Section title="AI policy">
          <p className="text-sm text-muted-foreground">{course.ai_policy ?? 'Not recorded yet.'}</p>
          <p className="text-sm">
            {course.ai_allowed
              ? 'AI is on for this course: notes get a cleaned copy and Ask can use them.'
              : 'AI is off for this course: nothing from it is sent to Claude.'}
          </p>
        </Section>
        {checklist.length ? (
          <Section title="Before you submit">
            <ul className="grid gap-1 text-sm">
              {checklist.map((c) => (
                <li key={c} className="flex gap-2">
                  <input type="checkbox" className="mt-1 size-4 accent-(--tie)" aria-label={c} />
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
        <Section title="Office hours">
          {hours.length ? (
            <ul className="grid gap-1 text-sm">
              {hours.map((h) => (
                <li key={h.who + h.when}>
                  <span className="font-semibold">{h.who}</span>, {h.when}
                  {h.where ? `, ${h.where}` : ''}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Not recorded yet.</p>
          )}
        </Section>
        <Section title="Staff and contacts">
          {staff.length ? (
            <ul className="grid gap-2 text-sm">
              {staff.map((s) => (
                <li key={s.name + s.role}>
                  <span className="font-semibold">{s.name}</span>, {s.role}
                  {s.office ? `, ${s.office}` : ''}
                  {s.email ? (
                    <a href={`mailto:${s.email}`} className="block text-tie underline-offset-2 hover:underline">
                      {s.email}
                    </a>
                  ) : null}
                  {s.notes ? <span className="block text-muted-foreground">{s.notes}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Not recorded yet.</p>
          )}
        </Section>
      </div>
    </div>
  );
}
