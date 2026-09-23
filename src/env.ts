import { z } from 'zod';

const serverSchema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(1),
  APP_URL: z.string().url(),
  ALLOWED_EMAIL: z.string().email(),
  CRON_SECRET: z.string().min(1).optional(),
  TOKEN_ENCRYPTION_KEY: z.string().min(1).optional(),
  INGEST_WEBHOOK_SECRET: z.string().min(1).optional(),
  UW_OPENDATA_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  /** Only for API keys that are not scoped to a workspace (sent as anthropic-workspace-id). */
  ANTHROPIC_WORKSPACE_ID: z.string().min(1).optional(),
  AI_MONTHLY_BUDGET_USD: z.coerce.number().default(15),
  MODEL_EXTRACT: z.string().default('claude-sonnet-5'),
  MODEL_CLEANUP: z.string().default('claude-sonnet-5'),
  MODEL_ASK: z.string().default('claude-sonnet-5'),
  MODEL_ASK_DEEP: z.string().default('claude-opus-5'),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  MS_CLIENT_ID: z.string().min(1).optional(),
  MS_TENANT: z.string().default('organizations'),
  VOYAGE_API_KEY: z.string().min(1).optional(),
});

const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

function formatError(scope: string, error: z.ZodError): string {
  const lines = error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`);
  return [
    `Invalid ${scope} environment variables:`,
    ...lines,
    '',
    'Check .env.local against .env.example, or set SKIP_ENV_VALIDATION=1 for a build without real secrets (CI, cloud sessions).',
  ].join('\n');
}

const skipValidation = process.env.SKIP_ENV_VALIDATION === '1';

/** process.env with empty values dropped, so `KEY=` in .env.local counts as unset. */
function setVars(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => Boolean(e[1])));
}

function parseServer(): z.infer<typeof serverSchema> {
  if (skipValidation) {
    return process.env as unknown as z.infer<typeof serverSchema>;
  }
  const result = serverSchema.safeParse(setVars());
  if (!result.success) {
    throw new Error(formatError('server', result.error));
  }
  return result.data;
}

function parseClient(): z.infer<typeof clientSchema> {
  const input = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
  if (skipValidation) {
    return input as unknown as z.infer<typeof clientSchema>;
  }
  const result = clientSchema.safeParse(input);
  if (!result.success) {
    throw new Error(formatError('client', result.error));
  }
  return result.data;
}

/** Server-only. Never import this into a 'use client' file. */
export const serverEnv = parseServer();

/** Safe to import anywhere: only holds NEXT_PUBLIC_* values. */
export const clientEnv = parseClient();
