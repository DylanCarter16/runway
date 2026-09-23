# Runway

@AGENTS.md

Personal course tracker for Dylan (Waterloo CS, Fall 2026). One user. Runway pulls deadlines, exams, and course info from the places Waterloo scatters them, stores all of it, and makes it easy to find. It also keeps lecture notes, and for courses whose outlines allow AI (STAT 230 this term), adds a Claude-cleaned copy and answers questions about them.

Priorities, in order:
1. Findability. Any deadline, note, link, or document is at most two taps away, and search finds it.
2. No missed deadlines. Every dated item reaches Google Calendar with reminders and prep time.
3. Keep everything. Raw inputs are stored verbatim. Nothing Dylan pastes is ever overwritten.

## Read first
- `docs/PROGRESS.md`: where the last session stopped. Read it before anything else.
- `docs/PHASES.md`: the build plan. One phase per session.
- `docs/SPEC.md`: pages, features, and product rules.
- `docs/SOURCES.md`: every data source, how to reach it, cadence, and known quirks.
- `docs/PROMPTS.md`: every Claude API prompt and JSON schema.
- `docs/DESIGN.md`: visual system, layout, and UI copy rules.
- `docs/SETUP.md`: accounts, env vars, and the manual steps Dylan does.

Open the doc that matches the task. Small fixes don't need all of them.

## Stack
- Next.js 16 (App Router, TypeScript strict, Turbopack), React 19
- Tailwind CSS 4 + shadcn/ui (Command, Tabs, Sheet, Dialog, Badge, Toggle Group)
- Supabase: Postgres, Auth, Storage, Cron (pg_cron + pg_net), Vault
- `@anthropic-ai/sdk` for all Claude calls
- FullCalendar (`@fullcalendar/react` + daygrid, timegrid, list, interaction)
- node-ical, cheerio, unpdf, zod, date-fns + date-fns-tz
- react-markdown + remark-gfm + remark-math + rehype-katex, `diff` for note comparison
- googleapis (Calendar only)
- Vitest (unit), Playwright (a few smoke tests)
- Vercel hosting. Google Apps Script bridge (`scripts/apps-script/Code.gs`) for Gmail ingest and the digest email.

## Commands
- `npm run dev`, `npm run build`, `npm run lint`, `npm run typecheck`, `npm run test`
- New migration: `npx supabase migration new <name>`. In a local session, apply it with `npx supabase db push --linked`. Cloud sessions may not reach the database, so from one, ask Dylan to apply it locally or in the Supabase SQL editor.
- After every migration: `npx supabase gen types typescript --linked > src/lib/db/types.ts` (cloud sessions use `--project-id "$SUPABASE_PROJECT_REF"`, which needs `SUPABASE_ACCESS_TOKEN`)
- Cloud sessions without app secrets build with `SKIP_ENV_VALIDATION=1 npm run build`
- `PGURL=... tests/db/run.sh` runs the schema checks against a scratch Postgres (see the script header)

## Layout
```
src/app/(auth)/login              sign-in page
src/app/(app)/...                 pages (routes listed in docs/SPEC.md)
src/app/api/cron/*                sync triggers called by Supabase Cron
src/app/api/jobs/run              job worker
src/app/api/ingest/*              signed webhooks from the Apps Script bridge
src/app/api/gcal/*                Google OAuth connect + callback
src/app/api/digest                digest payload for the bridge
src/app/api/ask                   streaming Ask endpoint
src/lib/db/                       Supabase clients, typed queries, generated types.ts
src/lib/sources/                  one module per source (learn-ics, cs251-schedule, cs251-examinfo, page-watch, open-data, email)
src/lib/ai/                       client, models, prompts/, schemas/, extract, cleanup, ask
src/lib/gcal/                     calendar sync
src/lib/reminders/                rules.ts (defaults) and the reminder generator
src/lib/jobs/                     queue helpers and job handlers
src/lib/search/                   alias expansion + search_all wrapper
src/lib/time/                     America/Toronto helpers
src/config/term-f26.ts            Fall 2026 seed (courses, links, pages, policies, Piazza ids)
supabase/migrations/              schema source of truth
tests/                            vitest specs, fixtures (pages, ai), db checks
```

## Workflow
- Phases S and 0 run in a local session on Dylan's computer. Later phases can run in cloud sessions.
- Read `docs/PROGRESS.md`, then work only on the current phase in `docs/PHASES.md`. Stop once its acceptance checks pass.
- Commit after each finished step with `phase N: <what changed>`. Small commits, easy to revert.
- Before every push: `npm run lint && npm run typecheck && npm run test && npm run build`. Fix failures first.
- End every session by updating `docs/PROGRESS.md`: done, in progress, blocked, next step, and anything Dylan has to do by hand.
- Stay in scope. Log outside ideas under "Later" in PROGRESS.md.
- If the docs don't cover a decision, choose the simpler option and log it under "Decisions".
- Files are UTF-8 without BOM, LF line endings.
- Show Dylan complete files in chat. He prefers them over diffs.

## Code rules
- Next.js 16: route protection lives in `proxy.ts` (exported function `proxy`). `params` and `searchParams` are Promises: `const { slug } = await params`.
- Auth is checked at three layers: `proxy.ts` redirects signed-out users, every server action and route handler calls `requireUser()`, and RLS guards every table.
- Supabase clients: server code calls `createServerClient` from `@supabase/ssr` inside the function that needs it. Browser code imports one memoized client from `src/lib/db/browser.ts`. Never create a client in a component body or pass one through a hook dependency list; that caused infinite render loops in a past project.
- The service-role client lives in `src/lib/db/admin.ts` and is imported only by `src/app/api/(cron|jobs|ingest|digest|feed)` and `src/lib/jobs`. Never import it into client code.
- Every table has `user_id` and an owner-only RLS policy. Copy the pattern in the init migration.
- Validate every external input with zod at the boundary: route handlers, server actions, parsed pages, LLM output.
- Timestamps are `timestamptz`. Convert only through `src/lib/time`. Date-only items set `all_day = true` and `time_known = false` and store local midnight in America/Toronto. DST ends Nov 1, 2026; tests cover dates on both sides.
- Ingest is idempotent: every synced row has `(source, source_ref)` and upserts on it. Running a sync twice changes nothing.
- Set `last_change_source` on every item update so the change log records who changed it.
- `notes.original_md` and `documents.raw_text` never change after insert (DB triggers enforce this).
- Slow work (LLM calls, syncs, calendar writes) goes through the `jobs` table. Each job step finishes in under 60 seconds so it fits Vercel Hobby. Enqueue, respond, and process with `after()`.
- Secrets live in `.env.local` (gitignored) and in Vercel. Never print one in chat, logs, test output, or commits.
- Cron routes check `Authorization: Bearer ${CRON_SECRET}`. Ingest and digest routes verify the HMAC signature and reject timestamps older than 5 minutes.

## AI rules
- Course AI switch: before building any prompt, call `assertAiAllowed(courseId)`. CS 245, CS 246, and CS 251 ban generative AI and name running course materials through it as a Policy 71 violation, so their notes, pastes, emails, and page diffs never reach Claude. Content with no course waits until Dylan picks one. STAT 230 allows AI as a study aid.
- Models come from env (`MODEL_EXTRACT`, `MODEL_CLEANUP`, `MODEL_ASK`, `MODEL_ASK_DEEP`) with defaults in `src/lib/ai/models.ts`.
- JSON output uses `output_config: { format: { type: "json_schema", schema } }`. Parse the result with the matching zod schema anyway.
- Citations and structured outputs can't share a request. Ask sends `search_result` blocks with citations enabled and gets plain text back.
- Keep a `parseJson()` helper that strips code fences before `JSON.parse` for any path without structured outputs.
- Anything extracted from free text becomes a `proposals` row. It never writes to `items` until Dylan approves it.
- Log every call to `ai_calls` (purpose, model, tokens, cost, duration, raw output).

## Source rules
- Fetch only URLs from `watched_pages` or the term config. Send a User-Agent naming the app. Use ETag and Last-Modified.
- Piazza arrives by email only. Its terms prohibit scraping, so no unofficial API clients.
- Never automate WatIAM, Duo, Odyssey, Quest, or LEARN logins, and never store Dylan's UW password.
- Don't fetch outline.uwaterloo.ca from the server; its robots.txt disallows it. Outlines arrive by paste.

## UI rules
- Follow `docs/DESIGN.md`. Sentence case. Buttons say what happens ("Save note", "Approve").
- Every item shows where it came from, links back to it, and says when that source last synced.
- Mobile first: check every page at 390px wide.
