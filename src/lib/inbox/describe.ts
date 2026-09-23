import { KIND_LABEL } from '@/lib/items/labels';
import type { ItemKind } from '@/config/term-f26';
import { formatTime, formatWhen } from '@/lib/time';
import type { CourseInfoPayload, CreateItemPayload, GradePayload, ItemFields, MeetingPayload, UpdateItemPayload } from './types';

// Plain-language text for a review card (SPEC 4.4): what will happen, and a
// before and after for updates. Pure, so the server renders it once.

export interface CardText {
  headline: string;
  rows: { label: string; before: string | null; after: string }[];
  /** Longer text shown under the headline (a policy, a note). */
  body: string | null;
}

const FIELD_LABEL: Record<string, string> = {
  late_policy: 'late policy',
  remark_policy: 'remark policy',
  ai_policy: 'AI policy',
  submission_platforms: 'submission platforms',
  grading_scheme: 'grading scheme',
  staff: 'staff and contacts',
  office_hours: 'office hours',
};

function when(f: ItemFields): string {
  const at = f.due_at ?? f.starts_at;
  if (!at) return 'no date yet';
  const start = new Date(at);
  const base = formatWhen(start, f.time_known ?? false);
  return f.time_known && f.ends_at ? `${base} to ${formatTime(new Date(f.ends_at))}` : base;
}

function kindLabel(kind: string | undefined): string {
  return kind ? (KIND_LABEL[kind as ItemKind] ?? kind) : 'item';
}

export function describeProposal(kind: string, payload: unknown, courseCode: string | null): CardText {
  const code = courseCode ? `${courseCode} ` : '';
  switch (kind) {
    case 'create_item': {
      const item = (payload as CreateItemPayload).item;
      const exam = item.kind === 'midterm' || item.kind === 'final';
      const due = item.due_at || item.starts_at ? `${exam ? 'on' : 'due'} ${when(item)}` : 'no date yet';
      const extras = [item.weight_percent !== null && item.weight_percent !== undefined ? `worth ${item.weight_percent}%` : null, item.location ? `in ${item.location}` : null]
        .filter(Boolean)
        .join(', ');
      return {
        headline: `Create ${code}${item.title ?? kindLabel(item.kind)}, ${due}${extras ? `, ${extras}` : ''}`,
        rows: [],
        body: null,
      };
    }
    case 'update_item': {
      const p = payload as UpdateItemPayload;
      const before = p.before ?? {};
      const rows: CardText['rows'] = [];
      const c = p.changes;
      if ('due_at' in c || 'starts_at' in c || 'time_known' in c) {
        rows.push({ label: 'Date', before: 'due_at' in before || 'starts_at' in before ? when(before) : null, after: when(c) });
      }
      for (const [field, label] of [
        ['title', 'Title'],
        ['kind', 'Kind'],
        ['location', 'Room'],
        ['seat', 'Seat'],
        ['weight_percent', 'Weight'],
      ] as const) {
        if (!(field in c)) continue;
        const fmt = (v: unknown) => (v === null || v === undefined || v === '' ? 'not set' : field === 'weight_percent' ? `${v}%` : String(v));
        rows.push({ label, before: field in before ? fmt(before[field]) : null, after: fmt(c[field]) });
      }
      if ('flags' in c) rows.push({ label: 'Flags', before: null, after: (c.flags ?? []).join(', ') || 'none' });
      if ('source_url' in c) rows.push({ label: 'Link', before: null, after: c.source_url ?? 'none' });
      return { headline: `Update ${code}${p.title}`, rows, body: null };
    }
    case 'course_info': {
      const p = payload as CourseInfoPayload;
      if (p.field === 'info_notes') return { headline: `Add to ${code}course notes: ${p.heading}`, rows: [], body: p.value };
      if (p.field === 'late_policy' || p.field === 'remark_policy' || p.field === 'ai_policy') {
        return { headline: `Set ${code}${FIELD_LABEL[p.field]}`, rows: [], body: p.value };
      }
      if (p.field === 'submission_platforms') return { headline: `Set ${code}submission platforms`, rows: [], body: p.value.join(', ') };
      if (p.field === 'grading_scheme') {
        return {
          headline: `Replace ${code}grading scheme (${p.value.length} parts)`,
          rows: [],
          body: p.value.map((g) => `${g.component}: ${g.weight_percent ?? '?'}%${g.notes ? ` (${g.notes})` : ''}`).join('\n'),
        };
      }
      if (p.field === 'staff') {
        return {
          headline: `Replace ${code}staff and contacts (${p.value.length})`,
          rows: [],
          body: p.value.map((s) => `${s.name}, ${s.role}${s.email ? `, ${s.email}` : ''}`).join('\n'),
        };
      }
      if (p.field !== 'office_hours') return { headline: `Update ${code}course info`, rows: [], body: null };
      return {
        headline: `Replace ${code}office hours (${p.value.length})`,
        rows: [],
        body: p.value.map((o) => `${o.who}: ${o.when}${o.where ? `, ${o.where}` : ''}`).join('\n'),
      };
    }
    case 'meeting': {
      const p = payload as MeetingPayload;
      return {
        headline: `Update ${code}class times (${p.meetings.length} from Quest)`,
        rows: [],
        body: p.meetings
          .map((m) =>
            [
              `${m.component} ${m.section}`,
              m.days.length ? `${m.days.join(' ')} ${m.start ?? ''}${m.end ? ` to ${m.end}` : ''}`.trim() : 'time TBA',
              m.location ?? 'room TBA',
              m.starts_on && m.starts_on === m.ends_on ? `on ${m.starts_on}` : null,
            ]
              .filter(Boolean)
              .join(', '),
          )
          .join('\n'),
      };
    }
    case 'grade': {
      const p = payload as GradePayload;
      const score = p.score === null ? 'no score' : p.out_of === null ? String(p.score) : `${p.score} / ${p.out_of}`;
      return { headline: `Record ${code}${p.label}: ${score}`, rows: [], body: null };
    }
  }
  return { headline: `${kind.replace(/_/g, ' ')} for ${code.trim() || 'no course'}`, rows: [], body: null };
}
