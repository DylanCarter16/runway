# Progress

Claude Code reads this first in every session and updates it before stopping.

## Now

- **Phase**: 0 done
- **Next step**: Phase 1 (Findability shell), new session
- **Waiting on Dylan**: nothing blocking Phase 1

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
- [ ] Sign in once at https://<APP_HOST> to confirm the 6-digit code arrives (Supabase's sender allows 2 emails/hour)
- [ ] Paste the magic-link email template into the Supabase dashboard (Authentication > Emails > Magic Link) — see "Decisions" below; the CLI can't push it on the free plan
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
| 2026-09-17 | Fresh start: mirrored the newer `runway-kit.zip` (with Dylan's Quest sections) over the working folder before Phase S | Dylan asked for a fresh start; the job's sandbox pins the working directory so the folder itself couldn't be deleted, only its contents replaced |
| 2026-09-17 | Deleted and recreated the GitHub repo `runway` instead of reusing it | It held one leftover commit with no app code, from an earlier abandoned Phase S attempt; Dylan chose delete-and-recreate over force-push or a new name |
| 2026-09-17 | Reused the existing empty Supabase project `runway` (ref <SUPABASE_PROJECT_REF>) instead of creating a third project | Free plan caps active projects at 2 and the account already had 2 (the other, "Prospect", is unrelated); the schema was already applied out-of-band so `supabase migration repair` marked it as tracked instead of re-running the SQL |
| 2026-09-17 | `config.toml` no longer declares `auth.email.template.magic_link`; its content lives in `supabase/templates/magic_link.html` for reference only | Supabase's free plan rejects email template pushes when using the default sender ("Email template modification is not available for free tier projects using the default email provider"); Dylan pastes it into the dashboard by hand |
| 2026-09-17 | `auth.email.otp_length` set to 6 (the hosted project's platform default was 8) | SPEC.md 7 specifies a 6-digit code |
| 2026-09-17 | Disabled Vercel's SSO deployment protection on the `runway` project | It defaulted to gating every `*.vercel.app` URL (including `/login`) behind Dylan's own Vercel account, which conflicts with the app's single point of access being its own OTP gate |
| 2026-09-17 | Set the Vercel project's framework preset to Next.js explicitly | It had been created (Phase S) before `package.json` existed, so Vercel locked it to "Other" and served only the static `public/` folder instead of the Next.js server output, 404ing every route until fixed |
| 2026-09-17 | Pinned `turbopack.root` in `next.config.ts` to the repo directory | A `package-lock.json` in Dylan's home directory (outside any repo) was confusing Turbopack's workspace-root inference |

## Later

- (nothing yet)

## Session log

Newest first. One entry per session: date, phase, model, what changed, commits, open issues, what Dylan must do next.

- 2026-09-17, Phase 0 (Sonnet, background session, same session as Phase S): scaffolded Next.js 16 into the kit, installed the full stack and shadcn/ui, wrote `src/env.ts`, the Supabase server/browser/admin clients, `proxy.ts` (session refresh, route protection), the 6-digit email OTP login gated on `ALLOWED_EMAIL`, America/Toronto time helpers with DST tests, Vitest/Playwright config, and the CI workflow. Deployed to Vercel; fixed two deploy-blocking issues along the way (SSO deployment protection, wrong framework preset from before `package.json` existed). Commit `phase 0: foundation` pushed to `main`. Confirmed live: production URL redirects `/` to `/login`, the login page renders, `select ... not relrowsecurity` still returns no rows. Open issues: Dylan hasn't yet done a real sign-in to confirm the code email arrives, and still needs to paste the magic-link template into the Supabase dashboard by hand (see Decisions). Next: Phase 1 (Findability shell), new session.
- 2026-09-17, Phase S (Sonnet, background session): fresh-started from the newer kit zip, created the GitHub repo, reused and migrated the Supabase project, generated app secrets, linked Vercel and pushed all env vars. Commit `phase S: setup` pushed to `main`. Open issue: Dylan still needs to copy `SUPABASE_DB_PASSWORD` into a password manager. Next: Phase 0 (Foundation), same session.
- 2026-09-17, planning (Claude chat): read all four outlines, seeded their dates and policies, added the per-course AI switch, and added 40 more stopgap calendar events (49 total). Schema checks now number 30.
- 2026-09-17, planning (Claude chat): fixed the CS 251 late policy, added the assignments parser and fixture, added Phase S (automated setup), and switched sign-in to email codes.
- 2026-09-15, planning (Claude chat): wrote the build kit. No app code yet.
