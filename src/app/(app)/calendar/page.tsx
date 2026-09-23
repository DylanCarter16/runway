import { Suspense } from 'react';
import { CalendarView, type CalendarItem, type CalendarReminder } from '@/components/app/calendar-view';
import { getAppContext } from '@/lib/db/queries';

export const metadata = { title: 'Calendar' };

export default async function CalendarPage() {
  const { supabase } = await getAppContext();
  const [items, reminders] = await Promise.all([
    supabase
      .from('items')
      .select('id, course_id, kind, title, due_at, starts_at, ends_at, all_day, time_known, progress, prep_days, location, seat')
      .eq('state', 'active')
      .or('due_at.not.is.null,starts_at.not.is.null')
      .order('due_at')
      .limit(2000),
    supabase
      .from('reminders')
      .select('id, course_id, title, remind_at')
      .is('done_at', null)
      .order('remind_at')
      .limit(500),
  ]);

  return (
    <div className="grid gap-4">
      <h2 className="hidden text-2xl font-semibold sm:block">Calendar</h2>
      <Suspense>
        <CalendarView items={(items.data ?? []) as CalendarItem[]} reminders={(reminders.data ?? []) as CalendarReminder[]} />
      </Suspense>
    </div>
  );
}
