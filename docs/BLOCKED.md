# Blocked

Items parked during autopilot runs (docs/AUTOPILOT.md). Each needs one human step; the code behind it is built and tested.

## Phase 2: UW Open Data key
- Needed: register for a key (docs/SETUP.md step 4: `POST https://openapi.data.uwaterloo.ca/v3/Account/Register?email=...&project=Runway&uri=https://<APP_HOST>`, then confirm with the emailed code at `/v3/Account/Confirm`). Put it in `.env.local` and in Vercel as `UW_OPENDATA_API_KEY` (production and preview, sensitive), then redeploy.
- Why: unblocks the daily sync of final exams (published Oct 2, 2026) and UW important dates.
- Done so far: `src/lib/sources/open-data.ts` (mappers for terms, important dates, and exam schedules, tested against synthetic fixtures in `tests/fixtures/sources/`), the `sync.open_data` job, the daily cron entry, and the Settings, Sync row. Without the key the source is skipped, not failed. The field names follow SOURCES.md; the first live run may show a format the fixtures didn't cover, so check Settings, Sync after it.
- Time: 10 minutes.

## Phase 2: LEARN feed URL
- Needed: in LEARN (https://learn.uwaterloo.ca/), open Calendar, then Settings, and turn on "Enable Calendar Feeds". Then Subscribe, choose "All Calendars and Tasks", copy the URL, and paste it into Runway at Settings, Integrations, LEARN feed (https://<APP_HOST>/settings/integrations).
- Why: STAT 230 and CS 245 deadlines from LEARN sync every hour.
- Done so far: parser (`src/lib/sources/learn-ics.ts`, tested against a synthetic feed), encrypted storage, the hourly `sync.learn_ics` job, unmatched events go to the review queue, and removed events are marked "no longer appears on its source". Saving the URL starts the first sync at once.
- Time: 5 minutes.

## Phase 2: scheduled jobs SQL
- Needed: run the "Scheduled jobs (step 5)" SQL from docs/SETUP.md in the Supabase SQL editor (https://supabase.com/dashboard/project/<SUPABASE_PROJECT_REF>/sql/new), with the production URL `https://<APP_HOST>` and the `CRON_SECRET` value from `.env.local`.
- Why: without it nothing runs on schedule; syncs only run from Settings, Sync, "Run now".
- Done so far: `/api/cron/sync` and `/api/jobs/run` are deployed and answer 401 without the secret and 202 with it (checked 2026-09-23).
- Time: 5 minutes.

## Phase 3: Anthropic API key can't make calls yet
- Needed: the key in `.env.local` is not scoped to a workspace, so the API answers "This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header". Either create a new key inside a workspace in the Claude Console (https://platform.claude.com/settings/keys, pick a workspace when creating it) and replace `ANTHROPIC_API_KEY` in `.env.local`, or keep the key and add `ANTHROPIC_WORKSPACE_ID=<workspace id>` (from https://platform.claude.com/settings/workspaces) to `.env.local`. Set a monthly spend limit on the workspace. Then ask a local Claude Code session to add `ANTHROPIC_API_KEY` (and `ANTHROPIC_WORKSPACE_ID` if used) to Vercel (production and preview, sensitive) and redeploy, and to re-record the AI fixtures with `.scratch/record-ai.ts`.
- Why: unblocks Claude extraction for STAT 230 pastes (outlines, announcements, grades, assignment headers) and page change summaries. Rule-based pastes (Quest schedules, Odyssey rows) and AI-off courses work without it.
- Done so far: the whole pipeline (`src/lib/ai`, `src/lib/inbox`, `src/lib/jobs/inbox.ts`) is built and tested against hand-written responses in `tests/fixtures/ai/`. Without a working key, STAT 230 pastes are stored with the note "Claude is not set up yet" (production has no key yet) or, locally, fail after three tries and show "Reading it failed" in the Library.
- Time: 10 minutes.
