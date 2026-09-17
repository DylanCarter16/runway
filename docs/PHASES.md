# Build phases

One phase per Claude Code session (Phases S and 0 share one). Each phase ends with its acceptance checks passing, a commit, a push, and an updated `docs/PROGRESS.md`. Don't start the next phase in the same session.

Suggested model per phase: Sonnet for UI and wiring, Opus or Fable for parsers, sync logic, and the AI pipeline.

Session kickoff (paste into Claude Code, change the number):

```
Read CLAUDE.md, then docs/PROGRESS.md, then Phase N in docs/PHASES.md.
Do Phase N only. Plan first and show me the plan, then build it step by step
with a commit after each step. Stop when the acceptance checks pass, update
docs/PROGRESS.md, and list anything I need to do by hand.
```

Phases S and 0 run in Claude Code on Dylan's computer (SETUP.md step 1), because they log in to GitHub, Supabase, and Vercel. Later phases can run in cloud sessions; builds there use `SKIP_ENV_VALIDATION=1`.

---

## Phase S: Setup (on Dylan's computer)
**Model**: Sonnet. **Runs**: in Claude Code on Dylan's computer, inside the unzipped kit folder. Phase 0 follows in the same session.

Ground rules for this phase: ask before creating anything in an account, keep every secret in `.env.local` (gitignored), never print a secret in chat or commit one, and stop if a step would pause or delete an existing project.

Checked on 2026-09-17: Supabase CLI 2.117.0 and Vercel CLI 59.20.0 support every command below. If a flag fails, check `--help`.

Tasks
1. Preflight: `git`, `node` 20 or newer, `npm`. For the GitHub CLI (`gh`), ask Dylan before installing it (Windows: `winget install --id GitHub.cli`; macOS: `brew install gh`). If he'd rather skip it, he creates an empty private repo on github.com and gives you the URL.
2. Ask Dylan for the email he'll sign in with and save it as `ALLOWED_EMAIL` in `.env.local`. It must be the email on his Supabase account: Supabase's built-in sender only emails members of the project's organization, at most 2 emails per hour. Also confirm the repo name (default `runway`).
3. Logins, one at a time; Dylan approves each in his browser: `gh auth login --web`, `npx supabase@latest login`, `npx vercel@latest login`.
4. GitHub: `git init -b main` if needed. Before the first commit, confirm `git check-ignore .env.local` prints the path. Commit the kit, then `gh repo create <name> --private --source . --remote origin --push`.
5. Supabase:
   - `npx supabase orgs list`. Ask which org to use if there's more than one.
   - `npx supabase projects list`. The free plan allows two active projects. If two are already active, stop and ask Dylan what to do.
   - Generate a 32-character database password into `.env.local` as `SUPABASE_DB_PASSWORD`.
   - Ask, then run `npx supabase projects create runway --org-id <id> --db-password "$SUPABASE_DB_PASSWORD" --region ca-central-1`. Wait until `projects list` shows it healthy.
   - `npx supabase init` if `supabase/config.toml` is missing (keep `supabase/migrations`). Then `npx supabase link --project-ref <ref> --password "$SUPABASE_DB_PASSWORD"` and `npx supabase db push --linked --password "$SUPABASE_DB_PASSWORD"`.
   - With `npx supabase db query` (see its `--help` for targeting the linked project), run the "RLS check" and "Storage bucket" snippets from SETUP.md. The RLS check must return no rows.
   - `npx supabase projects api-keys --project-ref <ref> --reveal -o json`. Write `NEXT_PUBLIC_SUPABASE_URL` (`https://<ref>.supabase.co`), `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, and `SUPABASE_PROJECT_REF` into `.env.local` without echoing the values.
   - `npx supabase gen types typescript --linked > src/lib/db/types.ts`.
6. Generate `CRON_SECRET` and `INGEST_WEBHOOK_SECRET` (32 random bytes, hex) and `TOKEN_ENCRYPTION_KEY` (32 random bytes, base64) into `.env.local`.
7. Vercel: `npx vercel link --yes --project runway`, then `npx vercel git connect` for the GitHub repo. If Vercel can't see the repo, Dylan grants access on the GitHub page Vercel opens. Add every variable from `.env.local` except `SUPABASE_DB_PASSWORD` and `SUPABASE_PROJECT_REF`, one environment per call, piping each value through stdin so it never appears on screen: `NEXT_PUBLIC_*` values for production, preview, and development; the others with `--sensitive` for production and preview (local development reads `.env.local`).
8. Record the project ref, Vercel project name, and repo URL (no secrets) in `docs/PROGRESS.md`. Commit `phase S: setup` and push. Remind Dylan to copy `SUPABASE_DB_PASSWORD` into his password manager.

Acceptance
- A private GitHub repo holds the kit.
- The Supabase project exists, the init migration is applied, the RLS check returns no rows, and the `library` bucket exists.
- `npx vercel env ls` lists the variables.
- `git check-ignore .env.local` prints the path, and no secret appears in the chat or in git history.

Commit: `phase S: setup`

---

## Phase 0: Foundation
**Model**: Sonnet. **Runs**: on Dylan's computer, in the same session as Phase S. **Needs**: Phase S finished.

Tasks
1. Create the Next.js 16 app. `create-next-app` refuses a folder that already has files, so scaffold into a temp folder and copy the result in:
   ```
   npx create-next-app@latest /tmp/runway-app --ts --tailwind --eslint --app --src-dir \
     --import-alias "@/*" --use-npm --disable-git --yes
   ```
   Turbopack is the default bundler in Next 16, so there's no flag for it. Copy everything except `node_modules` into the repo root without overwriting the kit's files, then run `npm install`. Keep the kit's README. Keep the generated `AGENTS.md` (current Next.js guidance for agents) and add a line `@AGENTS.md` under the title in CLAUDE.md so it loads each session. Merge `.gitignore` and add `!.env.example` so the example file stays tracked. Add `typecheck` (`tsc --noEmit`) and `test` (`vitest run`) scripts.
2. Install the stack from CLAUDE.md. Initialize shadcn/ui and add Command, Tabs, Sheet, Dialog, Badge, Toggle Group, Button, Input, Textarea, Select, Tooltip, Sonner.
3. `src/env.ts`: zod-validated env (server and client parts). The build fails with a readable message when a required var is missing, unless `SKIP_ENV_VALIDATION=1` (used by CI and cloud sessions).
4. Supabase is already created, linked, and migrated by Phase S, and `src/lib/db/types.ts` exists. Regenerate the types only if the schema changed.
5. Supabase clients: `src/lib/db/server.ts`, `src/lib/db/browser.ts` (memoized), `src/lib/db/admin.ts` (service role, server only), `src/lib/db/proxy.ts` (`updateSession`).
6. `proxy.ts`: refresh the session, redirect signed-out users to `/login`, send signed-in users away from `/login`. Exclude `/api/cron`, `/api/jobs`, `/api/ingest`, `/api/digest`, and static assets from the matcher.
7. `/login` with a 6-digit code sent by email (Supabase email OTP: `signInWithOtp`, then `verifyOtp` with type `email`). The server action compares the address to `ALLOWED_EMAIL` before asking Supabase to send anything, so other addresses never use the 2-per-hour email allowance; they see "This app is private." Codes work even when the email opens in a different browser. Add `{{ .Token }}` to the Magic Link email template in `supabase/config.toml` and push it with `npx supabase config push` (review the diff it shows first). If the push doesn't cover templates, ask Dylan to paste the template under Authentication, Emails in the dashboard. Sessions last until sign-out.
8. `requireUser()` helper for server actions and route handlers.
9. `src/lib/time`: `toTorontoDate`, `fromTorontoLocal(date, time | null)`, `formatDue`, `startOfTorontoDay`, with tests on both sides of Nov 1, 2026.
10. Vitest and Playwright config. GitHub Actions workflow running lint, typecheck, test, build with `SKIP_ENV_VALIDATION=1`.
11. Deploy with `npx vercel deploy --prod`. Put the production URL in `APP_URL` (Vercel and `.env.local`). In `supabase/config.toml`, set `site_url` to the production URL and `additional_redirect_urls` to the production URL pattern and `http://localhost:3000/**`, run `npx supabase config push`, and deploy again. Keep the README current.

Acceptance
- On the production URL, `ALLOWED_EMAIL` receives a 6-digit code and signs in. Any other address sees "This app is private" and no email is sent.
- `select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity` returns no rows in Supabase.
- Time helper tests pass, including `fromTorontoLocal('2026-11-12', '16:30')` giving `2026-11-12T21:30:00Z`.
- CI is green. `npm run build` passes locally.

Commit: `phase 0: foundation`

---

## Phase 1: Findability shell
**Model**: Sonnet.

Tasks
1. App layout per DESIGN.md: left rail on desktop, bottom bar and course chips on mobile, theme tokens, fonts, light and dark mode.
2. Settings > Term: "Load Fall 2026 setup" imports `src/config/term-f26.ts` (term, courses with their AI switches, links, watched pages, the outline seed items with `source = 'seed'`, term items, and the settings row). Running it twice changes nothing.
3. Course pages with tabs. Build Overview, Deadlines, and Resources fully. Notes, Ask, Updates, Grades, and Library show empty states with the action that will fill them.
4. Items: quick-add dialog (course, kind, title, date, optional time, optional weight), item drawer, `/items/[id]`, edit (adds edited fields to `locked_fields`), progress control, dismiss.
5. Calendar page (SPEC 4.2) with course and kind filters in the URL.
6. Today page (SPEC 4.1) with runway bars.
7. Links: add, edit, pin, reorder on the Resources tab; pinned links as header buttons.
8. Search: command palette and `/search` backed by `search_all`, with alias expansion in `src/lib/search` (unit tested).
9. Coverage meter placeholder on Overview (reads undated items; real data arrives in Phase 3).

Acceptance
- After loading the Fall 2026 setup, four courses appear with their colors and links, and the outline items show on the Calendar (CS 246 midterm Nov 10, STAT 230 midterm 1 Oct 8, CS 245 midterm Oct 29 with a "confirm date" badge from its flag).
- Quick-adding "CS 251, assignment, A1, Sep 30, no time" shows it on Today, on the Calendar as an all-day event marked "(time TBD)", and in the CS 251 Deadlines tab.
- The palette finds that item for "a1", "251 a1", and "cs251 A1", and finds the Odyssey link for "odysey".
- Every page works at 390px wide. Keyboard: palette opens with Ctrl/Cmd+K and arrows move through results.
- Lint, typecheck, test, build pass.

Commit: `phase 1: findability shell`

---

## Phase 2: Automatic sources
**Model**: Opus or Fable. **Needs from Dylan**: the UW Open Data key (SETUP.md step 4), the scheduled jobs SQL right after this phase deploys (step 5), then the LEARN feed URL in Settings (step 3).

Tasks
1. Job queue: `src/lib/jobs` (enqueue with dedupe key, handlers registry), `POST /api/jobs/run` (checks `CRON_SECRET`, calls `requeue_stale_jobs`, claims jobs, responds 202, processes with `after()`), exponential backoff on failure.
2. `POST /api/cron/sync?set=hourly|every_3h|daily` enqueues the sync jobs for that cadence. `sync_runs` rows for every run.
3. Encryption helper (AES-256-GCM) and the LEARN feed URL field in Settings > Integrations.
4. LEARN sync (SOURCES.md section 1).
5. CS 251 schedule, exam info, and assignments parsers as pure functions with the fixture tests, then their sync steps with the merge rules (SOURCES.md sections 2, 3, and 3b).
6. Page watcher (section 4), without the Claude summary for now: store snapshots and show raw diffs in Updates.
7. Open Data sync for finals and important dates (section 7). An empty exam schedule before Oct 2 counts as success.
8. Settings > Sync page with "Run now" per source. Today's failing-source banner.
9. Updates tab: item changes and page diffs, newest first.

Acceptance
- Parser tests match all three expected JSON files exactly.
- Running every sync twice in a row creates no duplicate items and no change-log rows on the second run.
- CS 251 A1 to A6, the midterm (Nov 12, 4:30 to 6:20pm), and reading week appear with source links, and A1 shows its 10:00 pm due time.
- Editing the fixture's A2 date in a test and re-running the sync logs one `due_at` change with source `cs251_schedule`.
- A manual edit to an item's date, followed by a sync with a different date, produces a proposal instead of an overwrite.
- Pointing the LEARN URL at a bad address shows a readable error on the Sync page after the run.

Commit: `phase 2: automatic sources`

---

## Phase 3: Paste inbox and review queue
**Model**: Opus or Fable. **Needs from Dylan**: Anthropic API key (SETUP.md step 6).

Tasks
1. `src/lib/ai/client.ts` (`callClaude`), `models.ts`, `pricing.ts`, `ai_calls` logging, `parseJson()`.
2. Prompts and schemas from PROMPTS.md: classifier, outline, announcement, Quest schedule, Odyssey row, grades, assignment header, generic, page diff summary. Rule-based parsers for Quest schedules and Odyssey rows (both are tables), with fixture tests.
3. `/inbox` paste box: store document (hash dedupe), enqueue classify then extract.
4. Review queue UI with approve, edit then approve, dismiss, bulk approve per document, duplicate matching (SPEC 4.4).
5. Applying proposals: create and update items, course info fields, links, meetings, grades. Approving sets `last_change_source = 'paste'` and clears matching `locked_fields`.
6. Library page and document detail page.
7. Coverage meter on Overview using approved outline assessments.
8. Page watcher gets the Claude diff summary and date-change proposals for AI-on courses. This term every watched page belongs to an AI-off course, so they keep raw diffs.
9. Settings > AI: spend this month by purpose.
10. Recorded AI fixtures in `tests/fixtures/ai/` (write realistic fake outlines, announcements, and Odyssey rows; don't copy real outlines).
11. AI switch, built before anything that calls Claude: `assertAiAllowed()`, the required course picker, store-only handling for AI-off courses, and the Settings > Courses switch with its confirmation step.

Acceptance
- Pasting a fake STAT 230 outline fixture produces create proposals with weights and dates, and course info proposals for the late and AI policies.
- Pasting anything for CS 245, CS 246, or CS 251 stores it and never calls Claude (a unit test spies on `callClaude`).
- Pasting the same text again says "Already saved" and creates nothing.
- Pasting a fake Odyssey row for the CS 251 midterm proposes an update with room and seat on the existing midterm, through the rule-based parser and without calling Claude.
- Approving a proposal writes the item and it shows on Today and Calendar.
- Unit tests run without network access.

Commit: `phase 3: paste inbox and review queue`

---

## Phase 4: Google Calendar, reminders, digest
**Model**: Opus or Fable. **Needs from Dylan**: Google Calendar access with the app published to production, and the Apps Script bridge installed (SETUP.md steps 7 and 8).

Tasks
1. `GET /api/gcal/connect` and `/api/gcal/callback`: OAuth with `https://www.googleapis.com/auth/calendar.app.created`, offline access, consent prompt. Store the refresh token encrypted. Create a secondary calendar named "Runway" and save its id.
2. Reminder rules (`src/lib/reminders/rules.ts`) and the generator for prep blocks, study blocks, check reminders, and paste reminders (SPEC section 5, SOURCES.md section 11).
3. Calendar sync job: for each active item and open reminder, compute a hash of the event fields; insert or patch only when the hash changed; delete events for dismissed items and done reminders. Store the Runway id in `extendedProperties.private.runwayId` so a lost `gcal_event_id` can be recovered by lookup. Enqueue on every item or reminder change, plus a nightly full reconcile.
4. Token failure handling: `invalid_grant` marks the integration `reauth_required` and shows a reconnect banner.
5. `POST /api/ingest/ping` and `GET /api/digest` with HMAC verification (shared helper for all ingest routes). Digest content per SPEC section 6, rendered as simple HTML plus plain text. Add a stub `POST /api/ingest/email` that verifies the signature and returns 202 without storing anything, so the bridge's 15-minute runs don't log errors before Phase 7.
6. Settings > Reminders and Settings > Integrations (Google status, bridge last ping).

Acceptance
- Approving or adding an item creates its calendar event with the rule's reminders within 2 minutes.
- Changing the due date moves the event; dismissing the item deletes it; marking it submitted removes pending reminders.
- Running the sync twice makes no Google API writes the second time (check the logs).
- Seven days after connecting, the calendar still syncs (the consent screen is in production).
- The Apps Script `setup()` run shows a successful ping in Settings, and the next morning's digest email arrives.

Commit: `phase 4: calendar sync and reminders`

---

## Phase 5: Notes
**Model**: Sonnet, or Opus for the cleanup pipeline.

Tasks
1. `/notes/new` form (SPEC 4.5) and note creation with `content_hash` dedupe.
2. Cleanup job: split the original at headings or blank-line groups into parts of about 3,000 tokens, clean each part with the cleanup prompt (parts run in sequence inside one job step when small, or as chained jobs when large), join them, save `cleaned_md`, `cleanup_model`, `cleaned_at`.
3. Metadata job (structured output): title if missing, topics, summary, open questions, and date mentions (as proposals linked through `source_note_id`).
4. Note page: Mine, Cleaned, Compare views; edit with preview; reset; re-run with instruction; open questions; "Ask about this note".
5. Markdown rendering with KaTeX and code highlighting in the reading font.
6. Chunking: after cleanup or edit, rebuild the note's chunks from the best copy (edited, else cleaned, else original), split by heading, about 400 to 800 tokens each.
7. Course Notes tab and `/notes` list with search.
8. Lecture-note paste reminders from course meetings (one per lecture day at 21:00).

Acceptance
- A messy STAT 230 fixture note with typos, a LaTeX formula, and a code block keeps the original byte for byte; the cleaned copy fixes the typos and keeps the formula and code unchanged.
- A CS 251 note is saved as written with no cleanup or metadata job, and its page explains why.
- Trying to change `original_md` through any code path fails.
- Compare view highlights the changed words.
- A STAT 230 note saying "midterm 2 moved to Nov 26" creates a proposal linked to the note.
- The palette finds the note by a topic word.

Commit: `phase 5: notes`

---

## Phase 6: Ask
**Model**: Opus or Fable.

Tasks
1. `POST /api/ask` streaming endpoint. Context assembly by scope:
   - note or item scope: the note's chunks, or the item's documents plus the course's notes near its date;
   - course scope: all of the course's note chunks when they fit in `ask_context_budget` tokens, otherwise the top chunks from `search_chunks` plus the 10 most recent;
   - everything: top 40 chunks from `search_chunks`.
   Always add the course context block (policies, next deadlines) when a course is in scope.
2. Each chunk goes in as a `search_result` block (`source: "chunk:<uuid>"`, title = note or document title with date, citations enabled). Put the stable corpus before the question and mark it with `cache_control`.
3. A `search_library` tool that runs `search_chunks` and returns `search_result` blocks, so Claude can pull more when the first set falls short. Limit to 3 tool rounds.
4. Citations: map each citation's source back to the chunk and parent; save them on the message; render markers and the sources panel.
5. Ask UI: scope picker, thread list, Deep toggle, quick prompts, AI policy banner, budget notice.
6. Course Ask tab and "Ask about this" entry points from notes, items, and open questions.

Acceptance
- With a STAT 230 fixture note on independence, "what's the difference between independent and mutually exclusive events?" answers with at least one citation that opens that note.
- A question the notes don't cover says so and adds the "General knowledge (not from your notes)" section.
- The scope picker lists only STAT 230, and a question scoped to a STAT 230 quiz shows the course's AI policy banner.
- Threads survive a reload. Asking in a thread keeps earlier messages in context.

Commit: `phase 6: ask`

---

## Phase 7: Email ingest
**Model**: Opus or Fable. **Needs from Dylan**: Piazza email settings and class mapping (SETUP.md step 9), and step 10 for the optional spike.

Tasks
1. Replace the Phase 4 stub of `POST /api/ingest/email`: verify the signature, validate the batch, skip known Gmail ids, store new messages, enqueue the Piazza prompt.
2. Class mapping from the email's links to a course (Settings > Courses mapping).
3. Piazza prompt handling: proposals, course info proposals, and an Updates entry with the summary and post link. Posts judged `noise` are stored but hidden from Updates by default.
4. Settings > Integrations shows the last email received.
5. Optional spike, 1 hour max: Microsoft Graph with delegated `Mail.Read` for Crowdmark emails. Record the outcome in PROGRESS.md either way.

Acceptance
- A signed fixture batch creates one document per new message and the expected proposals; sending it again creates nothing.
- A bad signature or a timestamp older than 5 minutes gets 401.
- A STAT 230 Piazza fixture saying "Quiz 2 moved to Nov 6" proposes an update, and a CS 251 fixture is stored and listed in Updates without calling Claude.

Commit: `phase 7: email ingest`

---

## Phase 8: Extras (any order, one per session)
**Model**: Sonnet unless noted.

- Grades tab: grade paste flow, weighted average from the grading scheme, "what do I need on the final" calculator.
- Hybrid search for Ask (Opus): pgvector column on `chunks` in a new migration, embeddings from Voyage AI (check the current recommended model and its vector size before writing the migration), combined ranking with `search_chunks`, behind a settings flag.
- Odyssey userscript and `POST /api/ingest/odyssey` with a personal token.
- PWA: manifest, icons, install prompt, offline shell for Today and Calendar.
- Data export (Settings > Data).
- Read-only ICS feed with a secret token, for Apple Calendar.
- Read-only MCP endpoint over items and notes so Claude chats can query Runway.
