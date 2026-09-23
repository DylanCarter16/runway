import { describe, expect, it } from 'vitest';
import { ApprovalError, planApproval, type ProposalRecord, type TargetItem } from '@/lib/inbox/apply';
import { IDS } from './context';

const P = (kind: string, payload: unknown, extra: Partial<ProposalRecord> = {}): ProposalRecord => ({
  id: 'p1',
  kind,
  course_id: IDS.stat230,
  target_item_id: null,
  source_document_id: IDS.doc,
  payload,
  ...extra,
});

const quiz: TargetItem = {
  id: IDS.statQuiz1,
  course_id: IDS.stat230,
  kind: 'quiz',
  title: 'Quiz 1',
  due_at: '2026-10-07T04:00:00.000Z',
  starts_at: null,
  ends_at: null,
  all_day: true,
  time_known: false,
  location: null,
  seat: null,
  weight_percent: null,
  locked_fields: ['due_at', 'title'],
};

describe('planApproval', () => {
  it('creates a pasted item with source paste and a link to its document', () => {
    const w = planApproval(
      P('create_item', { source: 'paste', item: { course_id: IDS.stat230, kind: 'midterm', title: 'Midterm 1', due_at: '2026-10-22T20:30:00.000Z', all_day: false, time_known: true, weight_percent: 20 } }),
      { userId: IDS.user },
    );
    expect(w.insertItem).toMatchObject({
      user_id: IDS.user,
      title: 'Midterm 1',
      source: 'paste',
      source_ref: 'paste:p1',
      source_document_id: IDS.doc,
      last_change_source: 'paste',
      weight_percent: 20,
    });
  });

  it('keeps a LEARN proposal under its own source and ref so later syncs match it', () => {
    const w = planApproval(P('create_item', { source: 'learn_ics', source_ref: 'UID:abc', item: { kind: 'other', title: 'Lab report', course_id: null } }), {
      userId: IDS.user,
    });
    expect(w.insertItem).toMatchObject({ source: 'learn_ics', source_ref: 'UID:abc', last_change_source: 'learn_ics' });
  });

  it('applies an update, clears the locks it answers, and records the source', () => {
    const w = planApproval(
      P('update_item', { source: 'paste', title: 'Quiz 1', changes: { due_at: '2026-10-09T04:00:00.000Z', starts_at: null, ends_at: null, all_day: true, time_known: false } }, { target_item_id: quiz.id }),
      { userId: IDS.user, target: quiz },
    );
    expect(w.updateItem).toEqual({
      id: quiz.id,
      patch: {
        due_at: '2026-10-09T04:00:00.000Z',
        starts_at: null,
        ends_at: null,
        all_day: true,
        time_known: false,
        locked_fields: ['title'],
        last_change_source: 'paste',
      },
    });
  });

  it('uses the edited values on "Edit then approve"', () => {
    const w = planApproval(
      P('update_item', { source: 'cs251_schedule', title: 'Quiz 1', changes: { due_at: '2026-10-09T04:00:00.000Z' } }),
      { userId: IDS.user, target: quiz },
      { type: 'item', courseId: IDS.stat230, kind: 'quiz', title: 'Quiz 1', date: '2026-10-09', time: '15:30', location: 'AL 113', seat: null, weight: null },
    );
    expect(w.updateItem?.patch).toMatchObject({
      due_at: '2026-10-09T19:30:00.000Z',
      all_day: false,
      time_known: true,
      location: 'AL 113',
      last_change_source: 'cs251_schedule',
    });
    expect(w.updateItem?.patch.title).toBeUndefined();
  });

  it('fails clearly when the target item is gone', () => {
    expect(() => planApproval(P('update_item', { source: 'paste', title: 'Quiz 1', changes: {} }), { userId: IDS.user, target: null })).toThrow(ApprovalError);
  });

  it('writes course info: policies replace, notes append, lists replace', () => {
    const course = { id: IDS.stat230, info_notes: 'Uses LEARN.' };
    expect(planApproval(P('course_info', { field: 'late_policy', value: 'No late work.' }), { userId: IDS.user, course }).updateCourse).toEqual({
      id: IDS.stat230,
      patch: { late_policy: 'No late work.' },
    });
    expect(
      planApproval(P('course_info', { field: 'info_notes', heading: 'Office hours', value: 'Thu 2 pm' }), { userId: IDS.user, course }).updateCourse?.patch,
    ).toEqual({ info_notes: 'Uses LEARN.\n\nOffice hours: Thu 2 pm' });
    expect(
      planApproval(P('course_info', { field: 'ai_policy', value: 'x' }), { userId: IDS.user, course }, { type: 'text', value: 'Edited policy' }).updateCourse?.patch,
    ).toEqual({ ai_policy: 'Edited policy' });
    expect(
      planApproval(P('meeting', { course_code: 'STAT 230', meetings: [{ component: 'LEC' }] }), { userId: IDS.user, course }).updateCourse?.patch,
    ).toEqual({ meetings: [{ component: 'LEC' }] });
  });

  it('records a grade and marks its item graded', () => {
    const w = planApproval(P('grade', { label: 'Quiz 1', score: 8, out_of: 10, item_id: quiz.id }), { userId: IDS.user, target: { ...quiz, weight_percent: 5 } });
    expect(w.insertGrade).toMatchObject({ course_id: IDS.stat230, item_id: quiz.id, score: 8, out_of: 10, weight_percent: 5, source: 'paste' });
    expect(w.updateItem?.patch).toEqual({ progress: 'graded', last_change_source: 'paste' });
  });
});
