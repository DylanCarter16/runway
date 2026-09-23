import { describe, expect, it } from 'vitest';
import { buildDigest, type DigestInput } from '@/lib/digest/build';
import { fromTorontoLocal } from '@/lib/time';

const now = fromTorontoLocal('2026-09-23', '08:00');

function input(over: Partial<DigestInput> = {}): DigestInput {
  return {
    now,
    appUrl: 'https://runway.example/',
    dueSoon: [],
    nextWeek: [],
    exams: [],
    pendingProposals: 0,
    reminders: [],
    failingSources: [],
    changes: [],
    ...over,
  };
}

describe('buildDigest', () => {
  it('does not send when every section is empty', () => {
    expect(buildDigest(input()).send).toBe(false);
  });

  it('lists each section with links and counts in the subject', () => {
    const d = buildDigest(
      input({
        dueSoon: [{ id: 'a1', label: 'CS 251 A1', due: fromTorontoLocal('2026-09-24', '22:00'), timeKnown: true }],
        nextWeek: [{ id: 'a2', label: 'STAT 230 A1', due: fromTorontoLocal('2026-09-30', null), timeKnown: false }],
        exams: [
          {
            id: 'm1',
            label: 'STAT 230 Midterm 1',
            due: fromTorontoLocal('2026-10-01', '16:30'),
            timeKnown: true,
            location: null,
            seat: null,
          },
        ],
        pendingProposals: 2,
        reminders: [{ title: 'Weekly sweep', whereToFind: 'Runway Inbox', url: '/inbox' }],
        failingSources: ['LEARN calendar feed'],
        changes: ['CS 251 A2 moved from Fri, Oct 23 to Mon, Oct 26, from CS 251 schedule page'],
      }),
    );
    expect(d.send).toBe(true);
    expect(d.subject).toBe('Runway, Wed, Sep 23: 1 due today or tomorrow, 1 exam in 2 weeks');
    expect(d.text).toContain('Due today and tomorrow\n- CS 251 A1: Thu, Sep 24, 10:00 pm (in 38 hours) https://runway.example/items/a1');
    expect(d.text).toContain('STAT 230 A1: Wed, Sep 30, time not set');
    expect(d.text).toContain('seat not posted yet');
    expect(d.text).toContain('2 proposals in the Inbox https://runway.example/inbox');
    expect(d.text).toContain('Weekly sweep. Runway Inbox https://runway.example/inbox');
    expect(d.text).toContain('LEARN calendar feed failed three times in a row');
    expect(d.text).toContain('Changed in the last 24 hours\n- CS 251 A2 moved');
    expect(d.html).toContain('<a href="https://runway.example/items/a1">');
  });

  it('escapes HTML in titles', () => {
    const d = buildDigest(input({ changes: ['<script>x</script> & more'] }));
    expect(d.html).toContain('&lt;script&gt;x&lt;/script&gt; &amp; more');
    expect(d.html).not.toContain('<script>');
  });
});
