'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { addGrade, deleteGrade, setGradeComponent } from '@/app/(app)/courses/actions';
import { formatPercent, neededOnFinal, type Standing } from '@/lib/grades/scheme';
import { selectClass } from '@/lib/ui';
import { cn } from '@/lib/utils';

const GUESS = '';

function ComponentOptions({ components }: { components: string[] }) {
  return (
    <>
      <option value={GUESS}>Guess from the name</option>
      {components.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </>
  );
}

/** Per mark: which component it counts toward, and Remove. */
export function MarkControls({ id, label, component, components }: { id: string; label: string; component: string | null; components: string[] }) {
  const [isPending, startTransition] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor={`mark-component-${id}`}>
        Component for {label}
      </label>
      <select
        id={`mark-component-${id}`}
        className={cn(selectClass, 'w-auto max-w-56')}
        defaultValue={component ?? GUESS}
        disabled={isPending}
        onChange={(e) => {
          const value = e.target.value;
          startTransition(async () => {
            const res = await setGradeComponent({ id, component: value || null });
            if (!res.ok) toast.error(res.error);
          });
        }}
      >
        <ComponentOptions components={components} />
      </select>
      <Button
        type="button"
        variant="ghost"
        className="h-11 sm:h-9"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            if (!window.confirm(`Remove the mark for ${label}?`)) return;
            const res = await deleteGrade({ id });
            if (!res.ok) toast.error(res.error);
            else toast.success('Mark removed');
          })
        }
      >
        Remove
      </Button>
    </div>
  );
}

export function AddMarkForm({ courseId, components }: { courseId: string; components: string[] }) {
  const [label, setLabel] = useState('');
  const [score, setScore] = useState('');
  const [outOf, setOutOf] = useState('');
  const [component, setComponent] = useState(GUESS);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const res = await addGrade({ courseId, label, score: Number(score), outOf: Number(outOf), component: component || null });
          if (!res.ok) return setError(res.error);
          toast.success('Mark saved');
          setLabel('');
          setScore('');
          setOutOf('');
          setComponent(GUESS);
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_6rem_6rem]">
        <label className="grid gap-1 text-sm" htmlFor="mark-label">
          <span className="font-semibold">Assessment</span>
          <Input id="mark-label" className="h-11 sm:h-9" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="A1" required />
        </label>
        <div className="grid grid-cols-2 gap-3 sm:contents">
          <label className="grid gap-1 text-sm" htmlFor="mark-score">
            <span className="font-semibold">Score</span>
            <Input id="mark-score" className="h-11 sm:h-9" type="number" inputMode="decimal" min={0} step="any" value={score} onChange={(e) => setScore(e.target.value)} required />
          </label>
          <label className="grid gap-1 text-sm" htmlFor="mark-out-of">
            <span className="font-semibold">Out of</span>
            <Input id="mark-out-of" className="h-11 sm:h-9" type="number" inputMode="decimal" min={0} step="any" value={outOf} onChange={(e) => setOutOf(e.target.value)} placeholder="100" required />
          </label>
        </div>
      </div>
      <label className="grid gap-1 text-sm" htmlFor="mark-component">
        <span className="font-semibold">Counts toward</span>
        <select id="mark-component" className={selectClass} value={component} onChange={(e) => setComponent(e.target.value)}>
          <ComponentOptions components={components} />
        </select>
      </label>
      {error ? (
        <p role="alert" className="text-sm text-late">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={isPending} className="h-11 sm:h-9">
          Save mark
        </Button>
      </div>
    </form>
  );
}

const TARGETS = [50, 60, 70, 80, 90];

/** "What do I need on the final": target course grade in, final percent out. */
export function FinalCalculator({ standing }: { standing: Standing }) {
  const [target, setTarget] = useState('70');
  const [assume, setAssume] = useState(() => String(Math.round(standing.average ?? 75)));
  const t = Number(target);
  const a = Number(assume);
  const valid = target !== '' && assume !== '' && Number.isFinite(t) && Number.isFinite(a);
  const need = valid ? neededOnFinal(standing, t, a) : null;
  const final = standing.final;
  if (!final) return null;

  const rows = TARGETS.map((goal) => ({ goal, need: neededOnFinal(standing, goal, valid ? a : (standing.average ?? 75)) }));

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <label className="grid gap-1 text-sm" htmlFor="calc-target">
          <span className="font-semibold">Course grade I want, %</span>
          <Input id="calc-target" className="h-11 sm:h-9" type="number" inputMode="decimal" min={0} max={100} step="any" value={target} onChange={(e) => setTarget(e.target.value)} />
        </label>
        <label className="grid gap-1 text-sm" htmlFor="calc-assume">
          <span className="font-semibold">Expected on the rest, %</span>
          <Input id="calc-assume" className="h-11 sm:h-9" type="number" inputMode="decimal" min={0} max={100} step="any" value={assume} onChange={(e) => setAssume(e.target.value)} />
        </label>
      </div>
      <p aria-live="polite" className="text-lg">
        {need ? <NeedSentence needed={need.needed} target={t} finalWeight={need.finalWeight} /> : 'Enter a target and what you expect on the rest.'}
      </p>
      {need && need.remainingWeight > 0 ? (
        <p className="text-sm text-muted-foreground">
          Assumes {formatPercent(a)} on the {formatPercent(need.remainingWeight)} of the course that has no marks yet, besides the final.
        </p>
      ) : null}
      <table className="tabular w-full max-w-md text-sm">
        <thead>
          <tr className="border-b border-rule text-left text-muted-foreground">
            <th className="py-1.5 pr-3 font-normal">Course grade</th>
            <th className="py-1.5 font-normal">Needed on the final</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ goal, need: n }) => (
            <tr key={goal} className="border-b border-rule last:border-0">
              <td className="py-1.5 pr-3">{goal}%</td>
              <td className={cn('py-1.5', n && n.needed > 100 && 'text-late')}>{n ? needLabel(n.needed) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function needLabel(needed: number): string {
  if (needed <= 0) return 'Already there';
  if (needed > 100) return `Out of reach (${formatPercent(needed)})`;
  return formatPercent(needed);
}

function NeedSentence({ needed, target, finalWeight }: { needed: number; target: number; finalWeight: number }) {
  if (needed <= 0) return <>You reach {formatPercent(target)} even with 0 on the final.</>;
  if (needed > 100)
    return (
      <>
        {formatPercent(target)} is out of reach: it would take <span className="tabular text-late">{formatPercent(needed)}</span> on the final.
      </>
    );
  return (
    <>
      You need <span className="tabular font-semibold">{formatPercent(needed)}</span> on the final (worth {formatPercent(finalWeight)}) for {formatPercent(target)}.
    </>
  );
}
