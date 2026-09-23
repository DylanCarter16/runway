import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCs251Assignments } from '@/lib/sources/cs251-assignments';
import { parseCs251ExamInfo } from '@/lib/sources/cs251-examinfo';
import { parseCs251Schedule } from '@/lib/sources/cs251-schedule';
import { syncCs251Assignments, syncCs251ExamInfo, syncCs251Schedule } from '@/lib/sync/cs251';
import { MemoryStore } from './memory-store';

const dir = path.resolve(import.meta.dirname, '../../fixtures/pages');
const read = (name: string) => readFileSync(path.join(dir, name), 'utf8');
const BASE = 'https://student.cs.uwaterloo.ca/~cs251/F26';
const ctx = (page: string) => ({ pageUrl: `${BASE}/${page}`, termYear: 2026 });
const COURSE = 'course-cs251';
const NOW = new Date('2026-09-23T12:00:00Z');

const scheduleHtml = read('cs251-schedule-f26.html');
const examHtml = read('cs251-examinfo-f26.html');
const assignHtml = read('cs251-assignments-f26.html');

function syncSchedule(store: MemoryStore, html: string) {
  return syncCs251Schedule(store, parseCs251Schedule(html, ctx('schedule.shtml')), COURSE, `${BASE}/schedule.shtml`, NOW);
}

async function runAll(store: MemoryStore, schedule = scheduleHtml) {
  const s = await syncSchedule(store, schedule);
  const e = await syncCs251ExamInfo(store, parseCs251ExamInfo(examHtml, ctx('examinfo.shtml')), COURSE, `${BASE}/examinfo.shtml`);
  const a = await syncCs251Assignments(store, parseCs251Assignments(assignHtml, ctx('assignments.shtml')), COURSE);
  return { s, e, a };
}

describe('CS 251 syncs', () => {
  it('create A1 to A6, the midterm with its time, reading week, and the final', async () => {
    const store = new MemoryStore();
    await runAll(store);
    const refs = store.items.map((i) => i.source_ref).sort();
    expect(refs).toEqual(
      ['cs251:A1', 'cs251:A2', 'cs251:A3', 'cs251:A4', 'cs251:A5', 'cs251:A6', 'cs251:break:2026-10-13', 'cs251:final', 'cs251:midterm'].sort(),
    );
    expect(store.items.every((i) => i.source === 'cs251_schedule' && i.course_id === COURSE)).toBe(true);

    const a1 = store.get('cs251_schedule', 'cs251:A1')!;
    expect(a1.due_at).toBe('2026-10-01T02:00:00.000Z'); // Sep 30, 10:00 pm EDT
    expect(a1.time_known).toBe(true);
    expect(a1.all_day).toBe(false);
    expect(a1.source_url).toBe(`${BASE}/assignments/a1.pdf`);

    const mt = store.get('cs251_schedule', 'cs251:midterm')!;
    expect(mt.starts_at).toBe('2026-11-12T21:30:00.000Z'); // 4:30 pm EST
    expect(mt.ends_at).toBe('2026-11-12T23:20:00.000Z');
    expect(mt.due_at).toBe(mt.starts_at);
    expect(mt.time_known).toBe(true);
    expect(mt.flags).toEqual(['location_tba']);
    expect(mt.source_url).toBe(`${BASE}/schedule.shtml`);

    const rw = store.get('cs251_schedule', 'cs251:break:2026-10-13')!;
    expect(rw).toMatchObject({ kind: 'break', title: 'Reading week', all_day: true, time_known: false });
    expect(rw.starts_at).toBe('2026-10-13T04:00:00.000Z');
    expect(rw.ends_at).toBe('2026-10-16T04:00:00.000Z');

    const fin = store.get('cs251_schedule', 'cs251:final')!;
    expect(fin.due_at).toBeNull();
    expect(fin.flags).toEqual(['date_tba', 'link_points_to_other_term', 'location_tba']);
  });

  it('change nothing on a second run: no duplicates, no writes, no change log', async () => {
    const store = new MemoryStore();
    await runAll(store);
    const count = store.items.length;
    const writes = store.writes;
    const changes = store.changes.length;
    const second = await runAll(store);
    expect(store.items.length).toBe(count);
    expect(store.writes).toBe(writes);
    expect(store.changes.length).toBe(changes);
    expect(second.s.created + second.s.updated + second.e.updated + second.a.updated).toBe(0);
  });

  it('keep the due time when the date-only schedule runs after the assignments page', async () => {
    const store = new MemoryStore();
    await syncCs251Assignments(store, parseCs251Assignments(assignHtml, ctx('assignments.shtml')), COURSE);
    await runAll(store);
    const a1 = store.get('cs251_schedule', 'cs251:A1')!;
    expect(a1.time_known).toBe(true);
    expect(a1.due_at).toBe('2026-10-01T02:00:00.000Z');
    expect(store.changes.filter((c) => c.item_id === a1.id)).toEqual([]);
  });

  it('log one due_at change from the schedule when A2 moves', async () => {
    const store = new MemoryStore();
    await runAll(store);
    const before = store.changes.length;
    const moved = scheduleHtml.replace('<td>Oct 23</td>', '<td>Oct 26</td>');
    expect(moved).not.toBe(scheduleHtml);
    await runAll(store, moved);
    const a2 = store.get('cs251_schedule', 'cs251:A2')!;
    expect(store.changes.slice(before)).toEqual([
      { item_id: a2.id, field: 'due_at', old_value: '2026-10-23T04:00:00.000Z', new_value: '2026-10-26T04:00:00.000Z', source: 'cs251_schedule' },
    ]);
  });

  it('drop the time when the date moves to another day', async () => {
    const store = new MemoryStore();
    await runAll(store);
    await syncSchedule(store, scheduleHtml.replace('<td>Sept 30</td>', '<td>Oct 2</td>'));
    const a1 = store.get('cs251_schedule', 'cs251:A1')!;
    expect(a1).toMatchObject({ time_known: false, all_day: true, due_at: '2026-10-02T04:00:00.000Z' });
  });

  it('propose instead of overwriting a date Dylan edited', async () => {
    const store = new MemoryStore();
    await runAll(store);
    const a3 = store.get('cs251_schedule', 'cs251:A3')!;
    await store.updateItem(a3.id, {
      due_at: '2026-11-10T22:00:00.000Z',
      all_day: false,
      time_known: true,
      locked_fields: ['due_at', 'all_day', 'time_known'],
      last_change_source: 'manual',
    });
    const moved = scheduleHtml.replace('<td>Nov 9</td>', '<td>Nov 11</td>');
    await runAll(store, moved);
    expect(store.get('cs251_schedule', 'cs251:A3')!.due_at).toBe('2026-11-10T22:00:00.000Z');
    const pending = store.proposals.filter((p) => p.state === 'pending');
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ kind: 'update_item', target_item_id: a3.id });
    expect(pending[0].payload.changes).toMatchObject({ due_at: '2026-11-11T05:00:00.000Z', time_known: false });

    await runAll(store, moved);
    expect(store.proposals).toHaveLength(1);
  });

  it('mark an upcoming item missing when the schedule drops it, without deleting it', async () => {
    const store = new MemoryStore();
    await runAll(store);
    const without = scheduleHtml.replace(/<tr class="week-start">\s*<td>Dec 7<\/td>[\s\S]*?<\/tr>/, '');
    expect(without).not.toBe(scheduleHtml);
    const stats = await syncSchedule(store, without);
    expect(stats.missing).toBe(1);
    expect(store.get('cs251_schedule', 'cs251:A6')!.source_missing_at).toBe(NOW.toISOString());
    const again = await syncSchedule(store, without);
    expect(again.missing + again.updated).toBe(0);
    await runAll(store);
    expect(store.get('cs251_schedule', 'cs251:A6')!.source_missing_at).toBeNull();
  });

  it('never touch state or progress', async () => {
    const store = new MemoryStore();
    await runAll(store);
    const a2 = store.get('cs251_schedule', 'cs251:A2')!;
    a2.state = 'dismissed';
    a2.progress = 'submitted';
    await runAll(store, scheduleHtml.replace('<td>Oct 23</td>', '<td>Oct 26</td>'));
    expect(store.get('cs251_schedule', 'cs251:A2')).toMatchObject({ state: 'dismissed', progress: 'submitted' });
  });
});
