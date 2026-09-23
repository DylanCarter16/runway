import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/lib/db/types';
import { anthropic } from '@/lib/jobs/ai';
import { searchChunks } from './load';
import type { AskDeps } from './run';

// The live Ask transport: the Anthropic SDK's message stream, turned into text
// pieces and per-block citations. Logging and search use the signed-in user's
// client, so RLS applies to both.

type Db = SupabaseClient<Database>;

const TOOL_RESULTS = 10;

export function liveAskDeps(db: Db): AskDeps {
  return {
    async stream(params, on) {
      const stream = anthropic().messages.stream(params);
      const citations = new Map<number, Anthropic.TextCitation[]>();
      for await (const event of stream) {
        if (event.type === 'content_block_start' && event.content_block.type === 'text') {
          citations.set(event.index, []);
          if (event.content_block.text) on({ type: 'text', text: event.content_block.text });
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') on({ type: 'text', text: event.delta.text });
          else if (event.delta.type === 'citations_delta') citations.get(event.index)?.push(event.delta.citation);
        } else if (event.type === 'content_block_stop' && citations.has(event.index)) {
          on({ type: 'block_end', citations: citations.get(event.index)! });
        }
      }
      return stream.finalMessage();
    },
    async log(row) {
      const { error } = await db.from('ai_calls').insert({ ...row, raw_output: row.raw_output as Json });
      if (error) console.error('could not log ai call:', error.message);
    },
    search: (query, courseIds) => searchChunks(db, query, courseIds, TOOL_RESULTS),
  };
}
