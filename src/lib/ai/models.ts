// Models come from env with the defaults in docs/PROMPTS.md.

export type Purpose =
  | 'classify'
  | 'extract_outline'
  | 'extract_announcement'
  | 'extract_piazza'
  | 'extract_quest'
  | 'extract_odyssey'
  | 'extract_assignment_header'
  | 'extract_crowdmark'
  | 'extract_generic'
  | 'extract_grades'
  | 'summarize_diff'
  | 'cleanup'
  | 'note_meta'
  | 'ask'
  | 'ask_deep';

export const DEFAULT_MODELS = {
  MODEL_EXTRACT: 'claude-sonnet-5',
  MODEL_CLEANUP: 'claude-sonnet-5',
  MODEL_ASK: 'claude-sonnet-5',
  MODEL_ASK_DEEP: 'claude-opus-5',
} as const;

type ModelVar = keyof typeof DEFAULT_MODELS;

function modelVar(purpose: Purpose): ModelVar {
  if (purpose === 'cleanup') return 'MODEL_CLEANUP';
  if (purpose === 'ask') return 'MODEL_ASK';
  if (purpose === 'ask_deep') return 'MODEL_ASK_DEEP';
  return 'MODEL_EXTRACT';
}

export function modelFor(purpose: Purpose, env: Record<string, string | undefined> = process.env): string {
  const key = modelVar(purpose);
  return env[key] || DEFAULT_MODELS[key];
}
