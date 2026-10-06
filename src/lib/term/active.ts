import { z } from 'zod';
import { TERM_EXAMPLE } from '@/config/term.example';
import type { SeedTerm } from '@/config/term.template';
import type { createClient } from '@/lib/db/server';

// Which term config "Load term setup" imports (Phase 10): the one stored in the user's
// settings row (uploaded from the gitignored src/config/term.local.ts), or the made-up
// example when nothing is stored. The stored JSON is checked at this boundary.

type Supabase = Awaited<ReturnType<typeof createClient>>;

const date = z.iso.date();
const item = z.object({ sourceRef: z.string().min(1), kind: z.string().min(1), title: z.string().min(1), date: date.nullable(), time: z.string().nullable() }).loose();
const link = z.object({ label: z.string().min(1), url: z.url(), category: z.string().min(1) }).loose();

export const seedTermSchema = z
  .object({
    code: z.string().min(1),
    name: z.string().min(1),
    startsOn: date,
    endsOn: date,
    timezone: z.string().min(1),
    courses: z.array(
      z
        .object({
          code: z.string().min(1),
          slug: z.string().regex(/^[a-z0-9-]+$/),
          title: z.string().min(1),
          color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
          colorDark: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
          aiAllowed: z.boolean(),
          links: z.array(link),
          watchedPages: z.array(z.object({ url: z.url() }).loose()),
          seedItems: z.array(item),
          meetings: z.array(z.object({}).loose()),
          gradingScheme: z.array(z.object({ component: z.string(), weightPercent: z.number() }).loose()),
        })
        .loose(),
    ),
    termItems: z.array(item),
    globalLinks: z.array(link),
    piazzaClasses: z.array(z.object({ nid: z.string().regex(/^[a-z0-9]+$/), url: z.url() })),
  })
  .loose();

export interface ActiveTerm {
  term: SeedTerm;
  /** `saved`: the user's own config. `example`: nothing stored (or it didn't parse). */
  source: 'saved' | 'example';
  /** Set when a stored config was there but failed the check. */
  problem: string | null;
}

/** Parses a stored config; null with the first problem when it isn't a usable term. */
export function parseSeedTerm(value: unknown): { term: SeedTerm | null; problem: string | null } {
  if (value === null || value === undefined) return { term: null, problem: null };
  const parsed = seedTermSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { term: null, problem: `${issue?.path.join('.') || 'term'}: ${issue?.message ?? 'not a term config'}` };
  }
  return { term: parsed.data as unknown as SeedTerm, problem: null };
}

export async function activeTerm(supabase: Supabase): Promise<ActiveTerm> {
  const { data } = await supabase.from('settings').select('term_seed').maybeSingle();
  const { term, problem } = parseSeedTerm(data?.term_seed);
  return term ? { term, source: 'saved', problem: null } : { term: TERM_EXAMPLE, source: 'example', problem };
}
