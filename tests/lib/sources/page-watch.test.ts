import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from '@/lib/crypto';
import { diffPageText, normalizePageText, sha256 } from '@/lib/sources/page-watch';

const html = readFileSync(path.resolve(import.meta.dirname, '../../fixtures/pages/cs251-examinfo-f26.html'), 'utf8');

describe('page watcher', () => {
  const text = normalizePageText(html);

  it('keeps visible text and drops comments, scripts, and styles', () => {
    expect(text).toContain('Thursday, November 12, 4:30-6:20pm');
    expect(text).not.toContain('Makeup Final Exam');
    expect(text).not.toContain('jquery');
    expect(text.split('\n').every((l) => l === l.trim() && l.length > 0)).toBe(true);
  });

  it('hashes the same page the same way, ignoring whitespace and comment edits', () => {
    const noisy = html.replace('<h2>Midterm</h2>', '<h2>Midterm</h2>   \n\n<!-- edited -->');
    expect(sha256(normalizePageText(noisy))).toBe(sha256(text));
  });

  it('diffs added and removed lines', () => {
    const changed = normalizePageText(html.replace('Location: TBA', 'Location: PAC 1, 2, 3'));
    expect(diffPageText(text, changed)).toEqual({ added: ['Location: PAC 1, 2, 3'], removed: ['Location: TBA'] });
    expect(diffPageText(text, text)).toEqual({ added: [], removed: [] });
  });
});

describe('secret encryption', () => {
  const key = randomBytes(32).toString('base64');

  it('round-trips and never contains the plain text', () => {
    const url = 'https://learn.uwaterloo.ca/d2l/le/calendar/feed/user/feed.ics?token=abc123';
    const c = encryptSecret(url, key);
    expect(c).not.toContain('abc123');
    expect(decryptSecret(c, key)).toBe(url);
    expect(encryptSecret(url, key)).not.toBe(c);
  });

  it('rejects a wrong key or a tampered value', () => {
    const c = encryptSecret('secret', key);
    expect(() => decryptSecret(c, randomBytes(32).toString('base64'))).toThrow();
    const parts = c.split('.');
    parts[3] = Buffer.from('other').toString('base64url');
    expect(() => decryptSecret(parts.join('.'), key)).toThrow();
    expect(() => encryptSecret('x', Buffer.from('short').toString('base64'))).toThrow(/32 bytes/);
  });
});
