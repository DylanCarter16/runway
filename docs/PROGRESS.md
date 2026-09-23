# Progress

Claude Code reads this first in every session and updates it before stopping.

## Now

- **Phase**: 2 done (2026-09-23, autopilot). Live LEARN and Open Data syncs are parked on Dylan's steps (docs/BLOCKED.md); their code is built and tested against fixtures.
- **Next step**: Phase 3 (Paste inbox and review queue), new session. `ANTHROPIC_API_KEY` is set in `.env.local`. Tests must use recorded fixtures in `tests/fixtures/ai/`. Build the AI switch (`assertAiAllowed`) first (Phase 3 task 11). Sync proposals already exist: `proposals.payload` holds `{source, source_ref, title, changes}` for `update_item` (a sync disagreeing with a locked field) and `{source, source_ref, item}` for `create_item` (LEARN events with no course). The review queue must render and apply both; approving an `update_item` applies `changes` and removes those fields from `locked_fields`.
- **Waiting on Dylan**: docs/BLOCKED.md (UW Open Data key, LEARN feed URL, scheduled jobs SQL). None block Phase 3.
- **Autopilot decisions**: `docs/DECISIONS.md`. Parked items: `docs/BLOCKED.md`.
- **Scratch checks** (gitignored `.scratch/`, run against the hosted project with a throwaway user they create and delete):
  - `.scratch/it.ts`: Phase 1 DB paths. `.scratch/smoke.ts`: Phase 1 UI at 1280 and 390px.
  - `.scratch/phase2.ts`: every CS 251 page sync twice against the live pages, merge rules, bad LEARN URL. `.scratch/phase2-smoke.ts`: Sync, Integrations, Updates, Today banner at 390 and 1280px (needs `npx next start -p 3100`).
  - Run with `set -a; . ./.env.local; set +a; NODE_OPTIONS=--conditions=react-server npx tsx --tsconfig tsconfig.json .scratch/<file>.ts`. The `react-server` condition lets scripts import `server-only` modules.
- **tests/db/run.sh** was not run this session (no scratch Postgres on this machine). The new migration only changes one function to security definer.

## Phase 2 map (where things live)

- Parsers (pure): `src/lib/sources/cs251-schedule.ts`, `cs251-examinfo.ts`, `cs251-assignments.ts`, `learn-ics.ts`, `open-data.ts`, `page-watch.ts` (normalize, hash, diff), `fetch.ts` (User-Agent, ETag, 10 s timeout, host-only errors).
- Merge rules (pure): `src/lib/sync/merge.ts`, `items.ts` (`syncItems`, `proposeUnmatched`, `ItemStore`), `cs251.ts`, `summary.ts`. Tests: `tests/lib/sync/` with `memory-store.ts`.
- Jobs: `src/lib/jobs/queue.ts` (enqueue with dedupe, `processJobs`, backoff), `sync.ts` (handlers `sync.page`, `sync.learn_ics`, `sync.open_data`, each writes `sync_runs`), `schedule.ts` (cadences, Run now), `tokens.ts` (encrypted LEARN URL), `item-store.ts`, `cron-auth.ts`. Encryption: `src/lib/crypto.ts`.
- Routes: `POST /api/jobs/run`, `POST /api/cron/sync?set=hourly|every_3h|daily` (Bearer `CRON_SECRET`, 202, work in `after()`).
- UI: Settings, Sync (row per source, Run now, errors, fail streak), Settings, Integrations (LEARN feed field), course Updates tab (item changes and page diffs), Today failing-source banner (three failed runs in a row).
- Job types added in later phases register in `HANDLERS` in `src/lib/jobs/schedule.ts`.

## Project facts (no secrets)

- GitHub repo: https://github.com/DylanCarter16/runway (private)
- Supabase project ref: <SUPABASE_PROJECT_REF> (name "runway", region ca-central-1) — reused an empty project from an earlier abandoned setup attempt instead of creating a third (free plan caps at 2 active projects; the account's other project, "Prospect", is unrelated and was left untouched)
- Vercel project: dylancarter16s-projects/runway, GitHub repo auto-connected. Production URL: https://<APP_HOST>

## Dylan's to-do

- [x] Stopgap calendar: 49 events added by Claude on 2026-09-17 (delete them once Phase 4 sync runs)
- [ ] SETUP step 0: LEARN feed in Google Calendar, Piazza email settings
- [x] CS 245 midterm date settled: Quest lists Thursday, Oct 29 only
- [x] SETUP step 1: setup session finished; Phase S and Phase 0 both done
- [x] Copy `SUPABASE_DB_PASSWORD` from `.env.local` into a password manager (do this now — the CLI has no way to recover a lost DB password, only reset it)
- [ ] After signing in, open Settings, Term and press "Load Fall 2026 setup" (safe to press again; it only adds what is missing). Then delete the 49 stopgap Google Calendar events only after Phase 4
- [ ] Sign in once at https://<APP_HOST> to confirm the 6-digit code arrives (Supabase's sender allows 2 emails/hour)
- [ ] Paste the magic-link email template into the Supabase dashboard (Authentication > Emails > Magic Link) — see "Decisions" below; the CLI can't push it on the free plan
- [ ] SETUP step 4 (UW Open Data key), step 5 (scheduled jobs SQL, Phase 2 is deployed), then step 3 (LEARN feed URL in Settings, Integrations). Details and links in docs/BLOCKED.md
- [x] Quest schedule read on 2026-09-17; sections seeded in the term config
- [ ] SETUP step 6 before Phase 3
- [ ] SETUP steps 7 and 8 before Phase 4
- [ ] SETUP step 9 before Phase 7 (step 10 is optional)
- [ ] SETUP step 2 only if a cloud session needs to change the database

## Kit contents (checked 2026-09-17)

- `supabase/migrations/20260915000000_init.sql`: applies cleanly on Postgres 16 and passes the 30 checks in `tests/db/schema-checks.sql` (RLS isolation between users, idempotent upserts, change log with sources, reminder cap, immutable note originals and raw documents, email id dedupe, search including typos, chunk retrieval, job queue claim and requeue, cascade deletes, AI switch default, flag change logging).
- `tests/fixtures/pages/`: the live CS 251 schedule and exam info pages (captured 2026-09-15, unchanged on 2026-09-17) and assignments page (captured 2026-09-17), each with expected parser output checked against a reference parser.
- `src/config/term-f26.ts`: passes `tsc --strict`. Holds all four outlines' dates (42 seed items with unique refs), grading schemes (each totals 100%), policies, staff, and AI switches. Every URL in it responded when checked.
- `scripts/apps-script/Code.gs`: request signing checked against a Node HMAC verifier, including non-ASCII email text and the empty-body GET.
- Phase S commands checked against Supabase CLI 2.117.0, Vercel CLI 59.20.0, and create-next-app 16.3.5 on 2026-09-17.

## Decisions

| Date | Decision | Why |
|---|---|---|
| 2026-09-15 | Piazza arrives by email only | Piazza's terms prohibit scraping |
| 2026-09-15 | Outlines, Quest, and Odyssey arrive by paste | WatIAM and Duo logins; outline.uwaterloo.ca disallows bots |
| 2026-09-15 | Gmail is read by an Apps Script under Dylan's account | Keeps the restricted Gmail scope out of the web app |
| 2026-09-15 | Calendar scope is `calendar.app.created` | Runway only manages the calendar it creates |
| 2026-09-15 | Supabase Cron runs schedules | Vercel Hobby cron runs once a day at an unpredictable minute |
| 2026-09-15 | Postgres full-text search first, embeddings later (Phase 8) | One student's notes fit; one less vendor |
| 2026-09-15 | Free-text extractions go through a review queue | Dates read from prose can be wrong |
| 2026-09-15 | Ask follows each course's AI policy on assignment questions | Outlines differ on AI use; the default is to explain concepts |
| 2026-09-17 | Setup and Phase 0 run in a local Claude Code session | The GitHub, Supabase, and Vercel CLIs can pass keys between services without Dylan copying them |
| 2026-09-17 | Sign-in uses a 6-digit email code | Removes Google Cloud from the first day of setup, and codes work across browsers on a phone |
| 2026-09-17 | CS 251 late policy corrected to "no late work" | The earlier "48 hours at 10% per day" text sits inside an HTML comment on the course page |
| 2026-09-17 | Added a CS 251 assignments page parser | It's the only CS 251 page with due times |
| 2026-09-17 | AI switch per course: off for CS 245, CS 246, CS 251; on for STAT 230 | The three CS outlines ban GenAI and name running course materials through it as a Policy 71 violation. STAT 230 allows it as a study aid |
| 2026-09-17 | Outline dates, weights, and policies are seeded in the term config | No AI extraction needed for this term's outlines |
| 2026-09-17 | Quest and Odyssey pastes use rule-based parsers | Both are tables, and it keeps AI away from AI-off courses |
| 2026-09-17 | Quest sections seeded as `meetings`; STAT 230 tutorial is section 104 (Fridays 3:30 to 4:20, AL 113) | Removes the `time_depends_on_section` flags and fixes workshop and quiz times |
| 2026-09-17 | Added `courses.ai_allowed` and `items.flags` | The switch needs a column, and parsers and seed data carry flags such as date_tba |
| 2026-09-17 | Fresh start: mirrored the newer `runway-kit.zip` (with Dylan's Quest sections) over the working folder before Phase S | Dylan asked for a fresh start; the job's sandbox pins the working directory so the folder itself couldn't be deleted, only its contents replaced |
| 2026-09-17 | Deleted and recreated the GitHub repo `runway` instead of reusing it | It held one leftover commit with no app code, from an earlier abandoned Phase S attempt; Dylan chose delete-and-recreate over force-push or a new name |
| 2026-09-17 | Reused the existing empty Supabase project `runway` (ref <SUPABASE_PROJECT_REF>) instead of creating a third project | Free plan caps active projects at 2 and the account already had 2 (the other, "Prospect", is unrelated); the schema was already applied out-of-band so `supabase migration repair` marked it as tracked instead of re-running the SQL |
| 2026-09-17 | `config.toml` no longer declares `auth.email.template.magic_link`; its content lives in `supabase/templates/magic_link.html` for reference only | Supabase's free plan rejects email template pushes when using the default sender ("Email template modification is not available for free tier projects using the default email provider"); Dylan pastes it into the dashboard by hand |
| 2026-09-17 | `auth.email.otp_length` set to 6 (the hosted project's platform default was 8) | SPEC.md 7 specifies a 6-digit code |
| 2026-09-17 | Disabled Vercel's SSO deployment protection on the `runway` project | It defaulted to gating every `*.vercel.app` URL (including `/login`) behind Dylan's own Vercel account, which conflicts with the app's single point of access being its own OTP gate |
| 2026-09-17 | Set the Vercel project's framework preset to Next.js explicitly | It had been created (Phase S) before `package.json` existed, so Vercel locked it to "Other" and served only the static `public/` folder instead of the Next.js server output, 404ing every route until fixed |
| 2026-09-17 | Pinned `turbopack.root` in `next.config.ts` to the repo directory | A `package-lock.json` in Dylan's home directory (outside any repo) was confusing Turbopack's workspace-root inference |

## Later

- CS 251 assignment PDFs (SOURCES.md 2, optional): fetch, store as `assignment_pdf`. Only useful with the assignment header prompt, which can't run for AI-off courses.
- Sort Settings, Sync rows by course, and say "first snapshot" instead of "page changed" on a page's first run.
- Calendar: add `@fullcalendar/luxon3` so the calendar renders in Toronto time even when the device is elsewhere (see DECISIONS.md).
- A Playwright smoke test that runs in CI would need a test user and a way to sign in without OTP; the local `.scratch/smoke.ts` covers it for now.

## Session log

Newest first. One entry per session: date, phase, model, what changed, commits, open issues, what Dylan must do next.

- 2026-09-23, Phase 2 (Opus 5.5, autopilot): CS 251 schedule, exam info, and assignments parsers match all three expected fixtures exactly. Merge rules as a pure planner with an in-memory store: running every sync twice writes nothing, a moved A2 logs one `due_at` change from `cs251_schedule`, a locked date gets a proposal instead of an overwrite (and isn't repeated), precision never drops, syncs never touch state or progress, dropped items get `source_missing_at`. LEARN feed parser, Open Data mappers (finals, important dates), page watcher with raw diffs, AES-256-GCM helper, job queue with dedupe and backoff, sync handlers writing `sync_runs`, cron and worker routes, Settings Sync and Integrations, Updates tab, Today banner. 83 unit tests. Checked on the hosted project with the live CS 251 pages: A1 to A6, the midterm Nov 12 4:30 to 6:20 pm, and reading week appear with links, A1 due 10:00 pm, the second run adds no items, change-log rows, or snapshots, and a bad LEARN URL shows "Could not reach ...: the connection failed." without the token. Found and fixed: jsonb reorders proposal keys (proposals repeated), and deleting a user with documents failed on the chunk trigger (migration `20260923010000_chunk_trigger_definer.sql`, applied). Production deploy Ready; `/api/jobs/run` answers 202 with the secret. Parked: live LEARN and Open Data syncs, scheduled jobs SQL (docs/BLOCKED.md). Next: Phase 3.

- 2026-09-23, Phase 1 (Opus 5.5, autopilot): found the hosted schema was an earlier draft (no `courses.ai_allowed` or `items.flags`) and caught it up with migration `20260923000000_init_drift.sql`, then regenerated types. Built the app shell per DESIGN.md (tokens, Atkinson Hyperlegible and Source Serif fonts, light and dark, 232px rail, icon rail on tablets, mobile top bar with course chips and bottom bar), the idempotent term import (Settings, Term), Today (week number, next exam countdown, needs-you strip, overdue with late policy, 14-day runway list with runway bars and progress, changed recently), Calendar (FullCalendar month, week, list; course and kind filters plus prep and reminder toggles in the URL; remembered view; click to open the drawer or quick add; `t` and arrows), course pages with all eight tabs (Overview, Deadlines, Resources fully; others with empty states), item drawer and `/items/[id]` with edit (adds to `locked_fields`), progress, dismiss, and change history, quick add, links add, edit, pin, reorder, delete, the command palette (Ctrl/Cmd+K, `/`, grouped results, recent items and searches, arrows) and `/search` with filters, alias expansion in `src/lib/search/aliases.ts`, keyboard shortcuts (`g` then a letter, `?`), and placeholder pages for Inbox, Notes, Ask, Library. 45 unit tests. Acceptance: checked through RLS with a throwaway user (import twice changes nothing; STAT 230 M1 Oct 8, CS 246 midterm Nov 10, CS 245 midterm Oct 29; quick-added A1 shows on Today, on the Calendar as "CS 251 A1 (time TBD)", and in CS 251 Deadlines; palette finds it for "a1", "251 a1", "cs251 A1" and finds Odyssey for "odysey"; every page loads at 390px with no horizontal scroll and no console errors). One acceptance line can't be met as written: the CS 245 midterm has no flag in the seed, so it shows no "confirm date" badge (see DECISIONS.md). Next: Phase 2.

- 2026-09-17, Phase 0 (Sonnet, background session, same session as Phase S): scaffolded Next.js 16 into the kit, installed the full stack and shadcn/ui, wrote `src/env.ts`, the Supabase server/browser/admin clients, `proxy.ts` (session refresh, route protection), the 6-digit email OTP login gated on `ALLOWED_EMAIL`, America/Toronto time helpers with DST tests, Vitest/Playwright config, and the CI workflow. Deployed to Vercel; fixed two deploy-blocking issues along the way (SSO deployment protection, wrong framework preset from before `package.json` existed). Commit `phase 0: foundation` pushed to `main`. Confirmed live: production URL redirects `/` to `/login`, the login page renders, `select ... not relrowsecurity` still returns no rows. Open issues: Dylan hasn't yet done a real sign-in to confirm the code email arrives, and still needs to paste the magic-link template into the Supabase dashboard by hand (see Decisions). Next: Phase 1 (Findability shell), new session.
- 2026-09-17, Phase S (Sonnet, background session): fresh-started from the newer kit zip, created the GitHub repo, reused and migrated the Supabase project, generated app secrets, linked Vercel and pushed all env vars. Commit `phase S: setup` pushed to `main`. Open issue: Dylan still needs to copy `SUPABASE_DB_PASSWORD` into a password manager. Next: Phase 0 (Foundation), same session.
- 2026-09-17, planning (Claude chat): read all four outlines, seeded their dates and policies, added the per-course AI switch, and added 40 more stopgap calendar events (49 total). Schema checks now number 30.
- 2026-09-17, planning (Claude chat): fixed the CS 251 late policy, added the assignments parser and fixture, added Phase S (automated setup), and switched sign-in to email codes.
- 2026-09-15, planning (Claude chat): wrote the build kit. No app code yet.
