// How a Library page follows a file while it is being read (2026-10-20, storage egress).
// It used to call router.refresh() every 4 seconds for as long as the file said "reading",
// which never ended when a job died, and each refresh re-rendered the whole page. Now it
// checks the file's status (one small query), refreshes only when something changed, waits
// longer the longer nothing changes, and stops after QUIET_LIMIT_MS of no change.

export const FIRST_DELAY_MS = 4_000;
export const MAX_DELAY_MS = 60_000;
export const QUIET_LIMIT_MS = 15 * 60_000;

export interface PollState {
  /** status and summary from the last check, or null before the first. */
  last: string | null;
  delay: number;
  /** When the status last changed (or polling began). */
  changedAt: number;
}

export interface PollStatus {
  status: string;
  summary: string | null;
}

export type PollStep = { refresh: boolean; next: PollState | null };

/** Several files as one status: reading while any is, changed when any changed. Null when none answered. */
export function combinedStatus(statuses: (PollStatus | null)[]): PollStatus | null {
  const known = statuses.filter((s): s is PollStatus => s !== null);
  if (!known.length) return null;
  const busy = known.some((s) => s.status === 'queued' || s.status === 'reading');
  return { status: busy ? 'reading' : 'done', summary: known.map((s) => `${s.status}:${s.summary ?? ''}`).join('\n') };
}

export function startPoll(now: number): PollState {
  return { last: null, delay: FIRST_DELAY_MS, changedAt: now };
}

/** One check: whether to refresh the page, and the next state (null: stop polling). */
export function pollStep(state: PollState, status: PollStatus | null, now: number): PollStep {
  if (status && status.status !== 'queued' && status.status !== 'reading') return { refresh: true, next: null };
  const key = status ? `${status.status}\n${status.summary ?? ''}` : state.last;
  const changed = status !== null && state.last !== null && key !== state.last;
  const changedAt = changed ? now : state.changedAt;
  if (now - changedAt >= QUIET_LIMIT_MS) return { refresh: false, next: null };
  const delay = changed ? FIRST_DELAY_MS : Math.min(Math.round(state.delay * 1.5), MAX_DELAY_MS);
  return { refresh: changed, next: { last: key, delay, changedAt } };
}
