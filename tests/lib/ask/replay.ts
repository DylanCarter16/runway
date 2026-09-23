import type Anthropic from '@anthropic-ai/sdk';
import type { AskDeps, StreamEvent } from '@/lib/ask/run';

// Replays recorded Ask answers as a stream. Chunk ids differ from run to run,
// so recorded citations name a phrase instead: "chunk:{{phrase}}" resolves to
// the search_result block in the request whose text contains that phrase, and
// "{{title}}" and "{{text}}" take that block's title and paragraph.

type Params = Anthropic.MessageCreateParamsNonStreaming;

function searchResults(params: Params): Anthropic.SearchResultBlockParam[] {
  const out: Anthropic.SearchResultBlockParam[] = [];
  const visit = (content: unknown) => {
    if (!Array.isArray(content)) return;
    for (const block of content as { type: string; content?: unknown }[]) {
      if (block.type === 'search_result') out.push(block as Anthropic.SearchResultBlockParam);
      else if (block.type === 'tool_result') visit(block.content);
    }
  };
  for (const m of params.messages) visit(m.content);
  return out;
}

function resolve(citation: Anthropic.TextCitation, params: Params): Anthropic.TextCitation | null {
  if (citation.type !== 'search_result_location') return citation;
  const phrase = /^chunk:\{\{(.+)\}\}$/.exec(citation.source)?.[1];
  if (!phrase) return citation;
  const results = searchResults(params);
  const index = results.findIndex((r) => r.content.some((t) => t.text.includes(phrase)));
  if (index < 0) return null;
  const hit = results[index];
  const block = hit.content.findIndex((t) => t.text.includes(phrase));
  return {
    ...citation,
    source: hit.source,
    title: hit.title,
    cited_text: hit.content[block].text,
    search_result_index: index,
    start_block_index: block,
    end_block_index: block + 1,
  };
}

export interface Replay {
  deps: AskDeps;
  requests: Params[];
  logs: unknown[];
}

export function replayAsk(messages: Anthropic.Message[], search: AskDeps['search'] = async () => []): Replay {
  const queue = [...messages];
  const requests: Params[] = [];
  const logs: unknown[] = [];
  const deps: AskDeps = {
    async stream(params, on: (e: StreamEvent) => void) {
      // Later rounds append to the same array, so keep a copy of what was sent.
      requests.push(structuredClone(params));
      const recorded = queue.shift();
      if (!recorded) throw new Error('No recorded answer left to replay.');
      const content = recorded.content.map((block) => {
        if (block.type !== 'text') return block;
        const citations = block.citations?.map((c) => resolve(c, params)).filter((c): c is Anthropic.TextCitation => c !== null) ?? null;
        // Stream in small pieces, like the live API.
        for (let i = 0; i < block.text.length; i += 24) on({ type: 'text', text: block.text.slice(i, i + 24) });
        on({ type: 'block_end', citations });
        return { ...block, citations };
      });
      return { ...recorded, content } as Anthropic.Message;
    },
    log: async (row) => void logs.push(row),
    search,
  };
  return { deps, requests, logs };
}
