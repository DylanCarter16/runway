import * as cheerio from 'cheerio';
import { z } from 'zod';
import { sha256 } from './page-watch';

// Piazza emails from the Apps Script bridge (SOURCES.md 6). The bridge posts
// batches of Gmail messages; each new one becomes a piazza_email document. The
// course comes only from the Piazza class id in the email's links, mapped in
// Settings, Courses. An email whose class isn't mapped is stored with no course
// and waits, so nothing reaches Claude until Dylan picks the course.

export const MAX_BODY_CHARS = 100_000;

export const emailMessageSchema = z.object({
  id: z.string().trim().min(1).max(200),
  threadId: z.string().max(200).optional(),
  date: z.iso.datetime({ offset: true }),
  from: z.string().max(500).default(''),
  subject: z.string().max(1000).default(''),
  text: z.string().max(MAX_BODY_CHARS).default(''),
  html: z.string().max(MAX_BODY_CHARS).nullish(),
});

export const emailBatchSchema = z.object({
  source: z.literal('piazza'),
  messages: z.array(emailMessageSchema).max(50),
});

export type EmailMessage = z.infer<typeof emailMessageSchema>;
export type EmailBatch = z.infer<typeof emailBatchSchema>;

/** Piazza class ids are lowercase letters and digits ("<PIAZZA_CLASS_1>"). */
const CLASS_LINK = /https?:\/\/(?:www\.)?piazza\.com\/class\/([a-z0-9]{8,24})\b([^\s"'<>)\]]*)/gi;

function links(msg: Pick<EmailMessage, 'text' | 'html'>): { nid: string; url: string }[] {
  const out: { nid: string; url: string }[] = [];
  for (const body of [msg.text, msg.html ?? '']) {
    for (const m of body.matchAll(CLASS_LINK)) {
      out.push({ nid: m[1].toLowerCase(), url: `https://piazza.com/class/${m[1].toLowerCase()}${m[2].replace(/&amp;/g, '&')}` });
    }
  }
  return out;
}

/** The Piazza class the email belongs to: the first class id in its links. */
export function piazzaClassId(msg: Pick<EmailMessage, 'text' | 'html'>): string | null {
  return links(msg)[0]?.nid ?? null;
}

/**
 * The post link: /class/<nid>/post/<id> or /class/<nid>?cid=<id>. Tracking
 * parameters other than cid are dropped.
 */
export function piazzaPostUrl(msg: Pick<EmailMessage, 'text' | 'html'>): string | null {
  for (const { nid, url } of links(msg)) {
    const post = url.match(/^https:\/\/piazza\.com\/class\/[a-z0-9]+\/post\/([A-Za-z0-9_-]+)/);
    if (post) return `https://piazza.com/class/${nid}/post/${post[1]}`;
    const cid = url.match(/[?&]cid=([A-Za-z0-9_-]+)/);
    if (cid) return `https://piazza.com/class/${nid}?cid=${cid[1]}`;
  }
  return null;
}

/** Plain text of an HTML body, one line per block, for emails with no text part. */
export function htmlToText(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, head').remove();
  $('br').replaceWith('\n');
  $('p, div, li, tr, h1, h2, h3, h4, h5, h6').each((_, el) => {
    $(el).append('\n');
  });
  return $.root()
    .text()
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .filter((l, i, all) => l || (i > 0 && all[i - 1]))
    .join('\n')
    .trim();
}

export interface MappedCourse {
  id: string;
  slug: string;
}

/** settings.piazza_map is {nid: course_slug}. */
export function courseForClass(nid: string | null, piazzaMap: Record<string, unknown>, courses: MappedCourse[]): MappedCourse | null {
  if (!nid) return null;
  const slug = piazzaMap[nid];
  if (typeof slug !== 'string') return null;
  return courses.find((c) => c.slug === slug) ?? null;
}

export interface EmailMeta {
  from: string;
  date: string;
  subject: string;
  class_id: string | null;
  post_url: string | null;
  thread_id: string | null;
  status?: 'stored_only';
  notes?: string[];
}

export interface EmailDocumentRow {
  user_id: string;
  course_id: string | null;
  kind: 'piazza_email';
  title: string;
  source_url: string | null;
  source_ref: string;
  raw_text: string;
  raw_html: string | null;
  content_hash: string;
  captured_at: string;
  meta: EmailMeta;
}

export const UNMAPPED_NOTE = 'No course yet: pick the course for this Piazza class in Settings, Courses. Nothing is read until then.';

/** The documents row for one message. The raw body is stored as sent. */
export function emailDocument(userId: string, msg: EmailMessage, course: MappedCourse | null): EmailDocumentRow {
  const html = msg.html ? msg.html : null;
  const text = msg.text.trim() ? msg.text : html ? htmlToText(html) : '';
  const classId = piazzaClassId(msg);
  const postUrl = piazzaPostUrl(msg);
  const subject = msg.subject.trim();
  const meta: EmailMeta = {
    from: msg.from,
    date: msg.date,
    subject,
    class_id: classId,
    post_url: postUrl,
    thread_id: msg.threadId ?? null,
  };
  if (!course) {
    meta.status = 'stored_only';
    meta.notes = [classId ? UNMAPPED_NOTE : 'No Piazza class link in this email, so it has no course.'];
  }
  return {
    user_id: userId,
    course_id: course?.id ?? null,
    kind: 'piazza_email',
    title: subject ? (subject.length > 300 ? `${subject.slice(0, 297)}...` : subject) : 'Piazza email',
    source_url: postUrl,
    source_ref: msg.id,
    raw_text: text,
    raw_html: html,
    // Two emails with the same body are still two messages, so the Gmail id is part of the hash.
    content_hash: sha256(`${msg.id}\n${text}`),
    captured_at: new Date(msg.date).toISOString(),
    meta,
  };
}

/** Where a batch's new documents get written. The route uses Supabase; tests use memory. */
export interface EmailStore {
  /** Gmail ids among `ids` already stored for this user. */
  knownIds(ids: string[]): Promise<Set<string>>;
  /** Inserts a row. Returns null when a unique index says it already exists. */
  insert(row: EmailDocumentRow): Promise<{ id: string } | null>;
}

export interface IngestResult {
  received: number;
  stored: number;
  skipped: number;
  /** New documents with a course: their extract jobs get queued. */
  toProcess: string[];
}

/** Stores each message the store hasn't seen. Sending the same batch again stores nothing. */
export async function ingestEmailBatch(
  store: EmailStore,
  userId: string,
  batch: EmailBatch,
  piazzaMap: Record<string, unknown>,
  courses: MappedCourse[],
): Promise<IngestResult> {
  const unique = [...new Map(batch.messages.map((m) => [m.id, m])).values()];
  const known = await store.knownIds(unique.map((m) => m.id));
  const result: IngestResult = { received: batch.messages.length, stored: 0, skipped: 0, toProcess: [] };
  for (const msg of unique) {
    if (known.has(msg.id)) {
      result.skipped++;
      continue;
    }
    const course = courseForClass(piazzaClassId(msg), piazzaMap, courses);
    const saved = await store.insert(emailDocument(userId, msg, course));
    if (!saved) {
      result.skipped++;
      continue;
    }
    result.stored++;
    if (course) result.toProcess.push(saved.id);
  }
  result.skipped += batch.messages.length - unique.length;
  return result;
}
