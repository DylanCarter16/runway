import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { COURSE_PALETTE } from '@/config/term.template';

// PHASES.md Phase 9, part C: Waterloo black, white, and gold, every contrast ratio at WCAG AA.
// Reads the tokens straight from globals.css so the check follows any later change.

const css = readFileSync(path.join(__dirname, '../../src/app/globals.css'), 'utf8');

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/--([a-z-]+):\s*(#[0-9A-Fa-f]{6});/g)].map((m) => [m[1], m[2]]));
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const light = block(':root');
const dark = { ...light, ...block('.dark') };
const UW_GOLD = '#FED34C';

describe.each([
  ['light', light],
  ['dark', dark],
])('%s theme', (_name, t) => {
  it('uses UW gold as the accent, with black on it', () => {
    expect(t.tie).toBe(UW_GOLD);
    expect(t['on-tie']).toBe('#000000');
    expect(contrast(t['on-tie'], t.tie)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['ink', 'graphite', 'link', 'soon', 'late'])('%s text passes AA (4.5:1) on paper and sheet', (token) => {
    expect(contrast(t[token], t.paper), `${token} on paper`).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t[token], t.sheet), `${token} on sheet`).toBeGreaterThanOrEqual(4.5);
  });

  it('text passes AA on the gold tint used for highlights', () => {
    expect(contrast(t.ink, t['accent-soft'])).toBeGreaterThanOrEqual(4.5);
  });

  it('focus rings, the now line, and checkboxes (mark) reach 3:1', () => {
    expect(contrast(t.mark, t.paper)).toBeGreaterThanOrEqual(3);
    expect(contrast(t.mark, t.sheet)).toBeGreaterThanOrEqual(3);
  });

  it('links stand apart from body text by an underline, not colour alone', () => {
    expect(css).toMatch(/\.text-link \{[^}]*text-decoration-line: underline/);
    expect(css).toMatch(/\.prose-note a \{[^}]*text-decoration: underline/);
  });

  it('urgency colours differ from each other and from the accent', () => {
    for (const [a, b] of [['soon', 'late'], ['soon', 'tie'], ['late', 'tie']]) expect(t[a]).not.toBe(t[b]);
  });
});

describe('course colours', () => {
  const hue = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b);
    const d = max - Math.min(r, g, b);
    if (!d) return 0;
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  };
  const goldHue = hue(UW_GOLD);

  it.each(Object.entries(COURSE_PALETTE).map(([name, c]) => [name, c.color, c.colorDark]))('%s marks reach 3:1 in both themes and stay clear of gold', (_code, color, colorDark) => {
    expect(contrast(color, light.paper)).toBeGreaterThanOrEqual(3);
    expect(contrast(color, light.sheet)).toBeGreaterThanOrEqual(3);
    expect(contrast(colorDark, dark.paper)).toBeGreaterThanOrEqual(3);
    expect(contrast(colorDark, dark.sheet)).toBeGreaterThanOrEqual(3);
    const gap = Math.min(Math.abs(hue(color) - goldHue), 360 - Math.abs(hue(color) - goldHue));
    expect(gap, 'hue distance from UW gold').toBeGreaterThanOrEqual(45);
  });
});
