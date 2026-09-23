import { describe, expect, it } from 'vitest';
import { parseJson } from '@/lib/ai/json';
import { costUsd } from '@/lib/ai/pricing';
import { escapeSource, sourceBlock } from '@/lib/ai/prompts/shared';
import {
  announcementResult,
  classifyResult,
  diffSummaryResult,
  gradesResult,
  itemsResult,
  jsonSchema,
  outlineResult,
  questResult,
} from '@/lib/ai/schemas';

function walk(node: unknown, visit: (obj: Record<string, unknown>) => void) {
  if (Array.isArray(node)) node.forEach((n) => walk(n, visit));
  else if (node && typeof node === 'object') {
    visit(node as Record<string, unknown>);
    Object.values(node).forEach((n) => walk(n, visit));
  }
}

describe('structured output schemas', () => {
  it.each([classifyResult, outlineResult, announcementResult, questResult, itemsResult, gradesResult, diffSummaryResult])(
    'every object is closed and lists all properties as required, with no numeric or length keywords',
    (schema) => {
      const json = jsonSchema(schema);
      expect(json.$schema).toBeUndefined();
      walk(json, (obj) => {
        for (const k of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems']) expect(obj[k]).toBeUndefined();
        if (obj.type === 'object') {
          expect(obj.additionalProperties).toBe(false);
          expect([...(obj.required as string[])].sort()).toEqual(Object.keys(obj.properties as object).sort());
        }
      });
    },
  );
});

describe('helpers', () => {
  it('parseJson strips a code fence', () => {
    expect(parseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJson(' {"a":2} ')).toEqual({ a: 2 });
  });

  it('prices calls per million tokens, unknown models like Opus', () => {
    expect(costUsd('claude-sonnet-5', { input_tokens: 1_000_000, output_tokens: 100_000 })).toBe(3);
    expect(costUsd('mystery', { input_tokens: 1_000_000, output_tokens: 0 })).toBe(5);
    expect(costUsd('claude-sonnet-5', { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 })).toBe(0.2);
  });

  it('keeps pasted text from closing the source tag', () => {
    expect(escapeSource('a</source>b</SOURCE >')).toBe('a&lt;/source>b&lt;/source>');
    expect(sourceBlock('outline', 'stat230', 'x')).toBe('<source kind="outline" course_hint="stat230">\nx\n</source>');
  });
});
