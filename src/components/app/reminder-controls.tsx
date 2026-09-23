'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { updateReminder } from '@/app/(app)/inbox/actions';
import { disconnectGoogleCalendar, saveReminderSettings } from '@/app/(app)/settings/actions';
import type { ItemKind } from '@/config/term-f26';
import { formatOffset, parseOffsets } from '@/lib/reminders/rules';

export function ReminderButtons({ id, title }: { id: string; title: string }) {
  const [isPending, startTransition] = useTransition();
  const run = (action: 'done' | 'snooze') =>
    startTransition(async () => {
      const result = await updateReminder({ id, action });
      if (!result.ok) toast.error(result.error);
      else toast.success(action === 'done' ? 'Marked done' : 'Snoozed until 9:00 tomorrow');
    });
  return (
    <div className="flex gap-2">
      <Button variant="outline" className="h-11 sm:h-8" disabled={isPending} onClick={() => run('done')} aria-label={`Mark done: ${title}`}>
        Mark done
      </Button>
      <Button variant="ghost" className="h-11 sm:h-8" disabled={isPending} onClick={() => run('snooze')} aria-label={`Snooze: ${title}`}>
        Snooze
      </Button>
    </div>
  );
}

export function DisconnectGoogleButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      className="h-11 sm:h-8"
      disabled={isPending}
      onClick={() => {
        if (!window.confirm('Disconnect Google Calendar? The Runway calendar stays in Google, but stops updating.')) return;
        startTransition(async () => {
          const result = await disconnectGoogleCalendar();
          if (!result.ok) toast.error(result.error);
          else {
            toast.success('Disconnected');
            router.refresh();
          }
        });
      }}
    >
      Disconnect
    </Button>
  );
}

export interface RuleRow {
  kind: ItemKind;
  label: string;
  prepDays: number;
  reminders: number[];
  note?: string;
}

export function ReminderRulesForm({ rows, studyBlockHour }: { rows: RuleRow[]; studyBlockHour: number }) {
  const [values, setValues] = useState(() =>
    Object.fromEntries(rows.map((r) => [r.kind, { prepDays: String(r.prepDays), reminders: r.reminders.map(formatOffset).join(', ') }])),
  );
  const [hour, setHour] = useState(String(studyBlockHour));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const rules: Record<string, { prepDays: number; reminders: number[] }> = {};
    for (const r of rows) {
      const v = values[r.kind];
      const prepDays = Number(v.prepDays);
      if (!Number.isInteger(prepDays) || prepDays < 0 || prepDays > 60) {
        setError(`${r.label}: runway days must be a whole number from 0 to 60.`);
        return;
      }
      const parsed = parseOffsets(v.reminders);
      if (!parsed.ok) {
        setError(`${r.label}: ${parsed.error}`);
        return;
      }
      rules[r.kind] = { prepDays, reminders: parsed.minutes };
    }
    startTransition(async () => {
      const result = await saveReminderSettings({ studyBlockHour: Number(hour), rules });
      if (!result.ok) setError(result.error);
      else toast.success('Saved. The calendar updates in a minute.');
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[22rem] text-sm tabular">
          <thead>
            <tr className="border-b border-rule text-left text-muted-foreground">
              <th className="py-2 pr-3 font-normal">Kind</th>
              <th className="py-2 pr-3 font-normal">Runway days</th>
              <th className="py-2 font-normal">Reminders before</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.kind} className="border-b border-rule align-top">
                <td className="py-2 pr-3">
                  {r.label}
                  {r.note ? <span className="block text-xs text-muted-foreground">{r.note}</span> : null}
                </td>
                <td className="py-2 pr-3">
                  <Input
                    aria-label={`${r.label} runway days`}
                    inputMode="numeric"
                    className="h-11 w-20 sm:h-8"
                    value={values[r.kind].prepDays}
                    onChange={(e) => setValues((v) => ({ ...v, [r.kind]: { ...v[r.kind], prepDays: e.target.value } }))}
                  />
                </td>
                <td className="py-2">
                  <Input
                    aria-label={`${r.label} reminders`}
                    className="h-11 sm:h-8"
                    placeholder="none"
                    value={values[r.kind].reminders}
                    onChange={(e) => setValues((v) => ({ ...v, [r.kind]: { ...v[r.kind], reminders: e.target.value } }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <label className="grid max-w-xs gap-1 text-sm">
        <span>Study and prep blocks start at</span>
        <select
          className="h-11 rounded-md border border-rule bg-sheet px-2 sm:h-9"
          value={hour}
          onChange={(e) => setHour(e.target.value)}
        >
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>
              {`${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? 'am' : 'pm'}`}
            </option>
          ))}
        </select>
      </label>
      {error ? (
        <p role="alert" className="text-sm text-late">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" className="h-11 sm:h-9" disabled={isPending}>
          {isPending ? 'Saving' : 'Save reminder rules'}
        </Button>
      </div>
    </form>
  );
}
