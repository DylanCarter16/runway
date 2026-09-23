// Plain-language summaries of sync_runs rows for Settings, Sync.

type Stats = Record<string, unknown>;

function num(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}

function counts(s: Stats): string[] {
  const parts: string[] = [];
  if (num(s.created)) parts.push(`${num(s.created)} added`);
  if (num(s.updated)) parts.push(`${num(s.updated)} updated`);
  if (num(s.proposals)) parts.push(`${num(s.proposals)} to review`);
  if (num(s.unmatched)) parts.push(`${num(s.unmatched)} with no course, to review`);
  if (num(s.missing)) parts.push(`${num(s.missing)} no longer listed`);
  return parts;
}

/** "3 added, 1 updated", "No changes", "Page unchanged since last check". */
export function runSummary(stats: unknown): string {
  const s = (stats ?? {}) as Stats;
  if (typeof s.skipped === 'string') return `Skipped: ${s.skipped}`;
  if (s.notModified) return 'Unchanged since the last check';
  const parts = counts(s);
  for (const key of ['dates', 'finals'] as const) {
    const sub = s[key];
    if (sub && typeof sub === 'object') {
      const p = counts(sub as Stats);
      if (p.length) parts.push(`${key === 'dates' ? 'important dates' : 'finals'}: ${p.join(', ')}`);
    }
  }
  if (has(s, 'examRows') && num(s.examRows) === 0) parts.push('exam schedule not published yet');
  if (num(s.replaced)) parts.push(`${num(s.replaced)} placeholder finals replaced`);
  if (s.snapshot) parts.push('page changed, snapshot saved');
  else if (s.changed === false && !parts.length) return 'No changes';
  return parts.length ? capitalize(parts.join(', ')) : 'No changes';
}

function has(s: Stats, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(s, k);
}

function capitalize(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export interface RunRow {
  source: string;
  ok: boolean | null;
  started_at: string;
  finished_at: string | null;
  error: string | null;
  stats: unknown;
}

/** Newest run, newest success, and how many runs in a row have failed. */
export function sourceHealth(runs: RunRow[]): { last: RunRow | null; lastOk: RunRow | null; failStreak: number } {
  const sorted = [...runs].sort((a, b) => b.started_at.localeCompare(a.started_at));
  let failStreak = 0;
  for (const r of sorted) {
    if (r.ok === false) failStreak++;
    else if (r.ok === true) break;
  }
  return { last: sorted[0] ?? null, lastOk: sorted.find((r) => r.ok === true) ?? null, failStreak };
}
