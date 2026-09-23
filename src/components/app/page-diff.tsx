// Raw added and removed lines from a watched page's snapshot (meta.diff).

export interface PageDiff {
  added: string[];
  removed: string[];
}

export function DiffLines({ diff, max = 12 }: { diff: PageDiff; max?: number }) {
  const lines = [...diff.removed.map((t) => ['-', t] as const), ...diff.added.map((t) => ['+', t] as const)];
  if (!lines.length) return null;
  return (
    <ul className="grid gap-0.5 rounded-md border border-rule bg-sheet p-2 font-mono text-[13px]">
      {lines.slice(0, max).map(([sign, text], i) => (
        <li key={i} className={sign === '+' ? 'text-foreground' : 'text-muted-foreground line-through'}>
          <span aria-hidden="true">{sign} </span>
          <span className="sr-only">{sign === '+' ? 'Added: ' : 'Removed: '}</span>
          {text}
        </li>
      ))}
      {lines.length > max ? <li className="text-muted-foreground">and {lines.length - max} more lines</li> : null}
    </ul>
  );
}
