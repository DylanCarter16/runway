import 'server-only';
import type { ReviewCard, ReviewGroup } from '@/components/app/review-queue';
import type { Course } from '@/lib/db/queries';
import type { createClient } from '@/lib/db/server';
import { sourceLabel } from '@/lib/items/labels';
import { formatAgo, toTorontoDate, toTorontoTime } from '@/lib/time';
import { describeProposal } from './describe';
import type { CourseInfoPayload, CreateItemPayload, ItemFields, UpdateItemPayload } from './types';

// Loads pending proposals for the review queue, grouped by where they came from.

type Supabase = Awaited<ReturnType<typeof createClient>>;

function formValues(f: ItemFields) {
  const at = f.due_at ?? f.starts_at ?? null;
  return {
    courseId: f.course_id ?? '',
    kind: f.kind ?? 'other',
    title: f.title ?? '',
    date: at ? toTorontoDate(new Date(at)) : '',
    time: at && f.time_known ? toTorontoTime(new Date(at)) : '',
    weight: f.weight_percent === null || f.weight_percent === undefined ? '' : String(f.weight_percent),
    location: f.location ?? '',
    seat: f.seat ?? '',
    description: '',
  };
}

export async function loadReviewGroups(supabase: Supabase, courses: Course[], opts: { courseId?: string; limit?: number } = {}): Promise<{ groups: ReviewGroup[]; total: number }> {
  let q = supabase
    .from('proposals')
    .select('id, kind, course_id, source_document_id, source_note_id, target_item_id, payload, evidence, confidence, created_at', { count: 'exact' })
    .eq('state', 'pending')
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 200);
  if (opts.courseId) q = q.eq('course_id', opts.courseId);
  const { data: proposals, count } = await q;
  const rows = proposals ?? [];

  const docIds = [...new Set(rows.map((p) => p.source_document_id).filter((x): x is string => Boolean(x)))];
  const itemIds = [...new Set(rows.map((p) => p.target_item_id).filter((x): x is string => Boolean(x)))];
  const [{ data: docs }, { data: items }] = await Promise.all([
    docIds.length ? supabase.from('documents').select('id, title, captured_at').in('id', docIds) : Promise.resolve({ data: [] }),
    itemIds.length
      ? supabase.from('items').select('id, course_id, kind, title, due_at, starts_at, ends_at, all_day, time_known, location, seat, weight_percent').in('id', itemIds)
      : Promise.resolve({ data: [] }),
  ]);
  const docById = new Map((docs ?? []).map((d) => [d.id, d]));
  const itemById = new Map((items ?? []).map((i) => [i.id, { ...i, weight_percent: i.weight_percent === null ? null : Number(i.weight_percent) }]));
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const now = new Date();

  const groups = new Map<string, ReviewGroup & { newest: string }>();
  for (const p of rows) {
    const payload = (p.payload ?? {}) as { source?: string };
    const course = p.course_id ? courseById.get(p.course_id) : undefined;
    const doc = p.source_document_id ? docById.get(p.source_document_id) : undefined;
    const target = p.target_item_id ? itemById.get(p.target_item_id) : undefined;
    const text = describeProposal(p.kind, p.payload, course?.code ?? null);

    let edit: ReviewCard['edit'] = null;
    if (p.kind === 'create_item') {
      edit = { type: 'item', initial: formValues({ ...(payload as CreateItemPayload).item, course_id: (payload as CreateItemPayload).item.course_id ?? p.course_id }) };
    } else if (p.kind === 'update_item' && target) {
      edit = { type: 'item', initial: formValues({ ...target, ...(payload as UpdateItemPayload).changes }) };
    } else if (p.kind === 'course_info') {
      const info = p.payload as unknown as CourseInfoPayload;
      if (info.field === 'late_policy' || info.field === 'remark_policy' || info.field === 'ai_policy' || info.field === 'info_notes') {
        edit = { type: 'text', initial: info.value };
      } else if (info.field === 'submission_platforms') {
        edit = { type: 'text', initial: info.value.join(', ') };
      }
    }

    const from = doc ? 'From your paste' : `From ${sourceLabel(payload.source ?? 'paste')}`;
    const card: ReviewCard = {
      ...text,
      id: p.id,
      courseColor: course?.color ?? null,
      evidence: p.evidence,
      sourceLine: `${from}, ${formatAgo(new Date(p.created_at), now)}`,
      sourceHref: doc ? `/library/${doc.id}` : target ? `/items/${target.id}` : null,
      edit,
    };

    const key = doc ? `doc:${doc.id}` : p.source_note_id ? `note:${p.source_note_id}` : `source:${payload.source ?? 'other'}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        title: doc ? doc.title : p.source_note_id ? 'Lecture notes' : sourceLabel(payload.source ?? 'other'),
        href: doc ? `/library/${doc.id}` : null,
        documentId: doc?.id ?? null,
        cards: [],
        newest: p.created_at,
      };
      groups.set(key, group);
    }
    group.cards.push(Object.assign(card, { _confidence: p.confidence ?? -1, _created: p.created_at }));
  }

  const ordered = [...groups.values()]
    .sort((a, b) => (a.newest < b.newest ? 1 : -1))
    .map(({ newest: _n, ...g }) => {
      void _n;
      const cards = (g.cards as (ReviewCard & { _confidence: number; _created: string })[])
        .sort((a, b) => b._confidence - a._confidence || (a._created < b._created ? 1 : -1))
        .map(({ _confidence: _c, _created: _d, ...c }) => {
          void _c;
          void _d;
          return c;
        });
      return { ...g, cards };
    });
  return { groups: ordered, total: count ?? rows.length };
}
