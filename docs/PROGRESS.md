# Progress

Claude Code reads this first in every session and updates it before stopping.

## Now

- **Phase**: S, not started
- **Next step**: Dylan starts the setup session (SETUP.md step 1), which runs Phase S and then Phase 0 on his computer
- **Waiting on Dylan**: starting that session

## Project facts (no secrets)

- GitHub repo: (Phase S fills this in)
- Supabase project ref: (Phase S)
- Vercel project and production URL: (Phase S and Phase 0)

## Dylan's to-do

- [x] Stopgap calendar: 49 events added by Claude on 2026-09-17 (delete them once Phase 4 sync runs)
- [ ] SETUP step 0: LEARN feed in Google Calendar, Piazza email settings
- [x] CS 245 midterm date settled: Quest lists Thursday, Oct 29 only
- [ ] SETUP step 1: run the setup session (Phases S and 0)
- [ ] Copy `SUPABASE_DB_PASSWORD` from `.env.local` into a password manager (Phase S asks)
- [ ] SETUP step 4 during Phase 2, step 5 right after it deploys, then step 3
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

## Later

- (nothing yet)

## Session log

Newest first. One entry per session: date, phase, model, what changed, commits, open issues, what Dylan must do next.

- 2026-09-17, planning (Claude chat): read all four outlines, seeded their dates and policies, added the per-course AI switch, and added 40 more stopgap calendar events (49 total). Schema checks now number 30.
- 2026-09-17, planning (Claude chat): fixed the CS 251 late policy, added the assignments parser and fixture, added Phase S (automated setup), and switched sign-in to email codes.
- 2026-09-15, planning (Claude chat): wrote the build kit. No app code yet.
