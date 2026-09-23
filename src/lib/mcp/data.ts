import 'server-only';
import type { Admin } from '@/lib/jobs/queue';
import type { McpCourse, McpData, McpItem, McpNote, McpNoteBody } from './server';

// The MCP tools' reads for one user. The route has no session (the token in its
// URL is the credential), so this runs on the service-role client and every query
// filters on user_id itself.

const ITEM_COLUMNS =
  'id, course_id, kind, title, description, starts_at, due_at, ends_at, all_day, time_known, location, seat, weight_percent, progress, flags, source, source_url';
const NOTE_COLUMNS = 'id, course_id, lecture_on, title, topics, summary, open_questions';

function fail(what: string, error: { message: string } | null): void {
  if (error) throw new Error(`Could not read ${what}: ${error.message}`);
}

function toItem(row: Omit<McpItem, 'weight_percent'> & { weight_percent: number | string | null }): McpItem {
  return { ...row, weight_percent: row.weight_percent === null ? null : Number(row.weight_percent) };
}

/** Characters PostgREST's filter grammar treats specially, dropped from ilike patterns. */
function likeSafe(text: string): string {
  return text.replace(/[%_,()*\\"]/g, ' ').trim();
}

export function mcpData(admin: Admin, userId: string): McpData {
  let courses: Promise<McpCourse[]> | null = null;

  return {
    courses() {
      courses ??= (async () => {
        const { data: term, error: termErr } = await admin
          .from('terms')
          .select('id')
          .eq('user_id', userId)
          .order('is_current', { ascending: false })
          .order('starts_on', { ascending: false })
          .limit(1)
          .maybeSingle();
        fail('the term', termErr);
        if (!term) return [];
        const { data, error } = await admin
          .from('courses')
          .select('id, code, slug, title, ai_allowed, site_url, outline_url, late_policy, grading_scheme')
          .eq('user_id', userId)
          .eq('term_id', term.id)
          .eq('archived', false)
          .order('sort_order');
        fail('courses', error);
        return data ?? [];
      })();
      return courses;
    },

    async itemsBetween(from, to, courseId) {
      const range = (col: string) => `and(${col}.gte.${from.toISOString()},${col}.lt.${to.toISOString()})`;
      let query = admin
        .from('items')
        .select(ITEM_COLUMNS)
        .eq('user_id', userId)
        .eq('state', 'active')
        .or(`${range('due_at')},${range('starts_at')}`)
        .limit(300);
      if (courseId) query = query.eq('course_id', courseId);
      const { data, error } = await query;
      fail('items', error);
      return (data ?? []).map(toItem);
    },

    async item(id) {
      const { data, error } = await admin.from('items').select(ITEM_COLUMNS).eq('user_id', userId).eq('id', id).maybeSingle();
      fail('the item', error);
      return data ? toItem(data) : null;
    },

    async searchItems(text, courseId, limit) {
      const base = () => {
        let q = admin.from('items').select(ITEM_COLUMNS).eq('user_id', userId).eq('state', 'active');
        if (courseId) q = q.eq('course_id', courseId);
        return q;
      };
      if (!text) {
        const { data, error } = await base().order('due_at', { ascending: true, nullsFirst: false }).limit(limit);
        fail('items', error);
        return (data ?? []).map(toItem);
      }
      const like = likeSafe(text);
      const [words, titles] = await Promise.all([
        base().textSearch('search', text, { type: 'websearch', config: 'english' }).limit(limit),
        like ? base().ilike('title', `%${like}%`).limit(limit) : Promise.resolve({ data: [], error: null }),
      ]);
      fail('items', words.error ?? titles.error);
      const seen = new Set<string>();
      const rows = [...(titles.data ?? []), ...(words.data ?? [])].filter((r) => !seen.has(r.id) && seen.add(r.id));
      return rows.slice(0, limit).map(toItem);
    },

    async notes(courseIds, limit) {
      if (!courseIds.length) return [];
      const { data, error } = await admin
        .from('notes')
        .select(NOTE_COLUMNS)
        .eq('user_id', userId)
        .in('course_id', courseIds)
        .order('lecture_on', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit);
      fail('notes', error);
      return (data ?? []) as McpNote[];
    },

    async note(id) {
      const { data, error } = await admin
        .from('notes')
        .select(`${NOTE_COLUMNS}, original_md, cleaned_md, edited_md`)
        .eq('user_id', userId)
        .eq('id', id)
        .maybeSingle();
      fail('the note', error);
      if (!data) return null;
      const { original_md, cleaned_md, edited_md, ...meta } = data;
      return { ...meta, body: edited_md ?? cleaned_md ?? original_md } as McpNoteBody;
    },

    async searchNotes(text, courseIds, limit) {
      if (!courseIds.length) return [];
      const base = () => admin.from('notes').select(NOTE_COLUMNS).eq('user_id', userId).in('course_id', courseIds);
      const like = likeSafe(text);
      const [words, titles] = await Promise.all([
        base().textSearch('search', text, { type: 'websearch', config: 'english' }).limit(limit),
        like ? base().ilike('title', `%${like}%`).limit(limit) : Promise.resolve({ data: [], error: null }),
      ]);
      fail('notes', words.error ?? titles.error);
      const seen = new Set<string>();
      const rows = [...(titles.data ?? []), ...(words.data ?? [])].filter((r) => !seen.has(r.id) && seen.add(r.id));
      return rows.slice(0, limit) as McpNote[];
    },
  };
}
