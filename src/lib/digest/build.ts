import { formatCountdown, formatListDate, formatWhen } from '@/lib/time';

// The morning digest (docs/SPEC.md section 6), as plain text and simple HTML. Pure:
// src/lib/digest/load.ts gathers the rows, GET /api/digest returns the result, and
// the Apps Script bridge emails it. send is false when every section is empty.

export interface DigestItem {
  id: string;
  label: string;
  due: Date;
  timeKnown: boolean;
}

export interface DigestExam extends DigestItem {
  location: string | null;
  seat: string | null;
}

export interface DigestReminder {
  title: string;
  whereToFind: string | null;
  url: string | null;
}

export interface DigestInput {
  now: Date;
  appUrl: string;
  dueSoon: DigestItem[];
  nextWeek: DigestItem[];
  exams: DigestExam[];
  pendingProposals: number;
  reminders: DigestReminder[];
  failingSources: string[];
  changes: string[];
}

export interface Digest {
  send: boolean;
  subject: string;
  text: string;
  html: string;
}

interface Section {
  title: string;
  lines: { text: string; href?: string }[];
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function itemLine(i: DigestItem, now: Date, base: string) {
  return {
    text: `${i.label}: ${formatWhen(i.due, i.timeKnown)} (${formatCountdown(i.due, i.timeKnown, now)})`,
    href: `${base}/items/${i.id}`,
  };
}

export function buildDigest(input: DigestInput): Digest {
  const base = input.appUrl.replace(/\/$/, '');
  const { now } = input;
  const sections: Section[] = [
    { title: 'Due today and tomorrow', lines: input.dueSoon.map((i) => itemLine(i, now, base)) },
    { title: 'Next 7 days', lines: input.nextWeek.map((i) => itemLine(i, now, base)) },
    {
      title: 'Exams in the next 14 days',
      lines: input.exams.map((e) => {
        const where = e.seat
          ? `${e.location ?? 'room not set'}, seat ${e.seat}`
          : e.location
            ? `${e.location}, seat not posted yet`
            : 'seat not posted yet';
        return { text: `${itemLine(e, now, base).text}. ${where}`, href: `${base}/items/${e.id}` };
      }),
    },
    {
      title: 'Waiting for review',
      lines: input.pendingProposals
        ? [
            {
              text: `${input.pendingProposals} ${input.pendingProposals === 1 ? 'proposal' : 'proposals'} in the Inbox`,
              href: `${base}/inbox`,
            },
          ]
        : [],
    },
    {
      title: 'Paste reminders',
      lines: input.reminders.map((r) => ({
        text: r.whereToFind ? `${r.title}. ${r.whereToFind}` : r.title,
        href: r.url ? (r.url.startsWith('/') ? `${base}${r.url}` : r.url) : `${base}/inbox#paste-reminders`,
      })),
    },
    {
      title: 'Sources failing',
      lines: input.failingSources.map((s) => ({
        text: `${s} failed three times in a row. Dates from it may be out of date.`,
        href: `${base}/settings/sync`,
      })),
    },
    { title: 'Changed in the last 24 hours', lines: input.changes.map((text) => ({ text })) },
  ].filter((s) => s.lines.length);

  const counts = [
    input.dueSoon.length ? `${input.dueSoon.length} due today or tomorrow` : null,
    input.exams.length ? `${input.exams.length} ${input.exams.length === 1 ? 'exam' : 'exams'} in 2 weeks` : null,
  ].filter(Boolean);
  const subject = `Runway, ${formatListDate(now)}${counts.length ? `: ${counts.join(', ')}` : ''}`;

  const text = [
    subject,
    '',
    ...sections.flatMap((s) => [s.title, ...s.lines.map((l) => `- ${l.text}${l.href ? ` ${l.href}` : ''}`), '']),
    `Open Runway: ${base}`,
  ].join('\n');

  const html = [
    '<div style="font-family: system-ui, sans-serif; font-size: 15px; line-height: 1.5; color: #1a1a1a; max-width: 560px">',
    ...sections.map(
      (s) =>
        `<h2 style="font-size: 17px; margin: 20px 0 6px">${esc(s.title)}</h2><ul style="margin: 0; padding-left: 20px">${s.lines
          .map((l) => `<li>${l.href ? `<a href="${esc(l.href)}">${esc(l.text)}</a>` : esc(l.text)}</li>`)
          .join('')}</ul>`,
    ),
    `<p style="margin-top: 24px"><a href="${esc(base)}">Open Runway</a></p>`,
    '</div>',
  ].join('\n');

  return { send: sections.length > 0, subject, text, html };
}
