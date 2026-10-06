# Handoff

Written 2026-09-23 at the end of the autopilot run. Phases S and 0 through 8 are built, pushed to `main`, and deployed at <APP_URL>. CI is green and production answers 200. What's left is mostly clicks only Dylan can make: keys, logins, and one SQL paste. Details for each are in `docs/BLOCKED.md`.

## Phase 10 update (2026-10-06)

Phase 10 is done and deployed (CI and Vercel green on `main`, production `/login` returns 200).

- **Secrets audit** (docs/AUDIT.md): no secret was ever committed, so nothing needs rotating. History still holds personal identifiers; tracked files no longer do.
- **Calendar**: 11:59 pm items and reminders draw one slot tall inside their own day; events at the same time sit side by side, with a "+N more" list on phones; new Day view.
- **Documents**: a Documents tab per course and uploads in the Library. Textbooks are indexed page by page with no AI, open in an in-app PDF viewer with a contents sidebar (bookmarks or numbered headings), and every page is searchable from the document, the course, the Library, and the palette.
- **Term config out of git**: your Fall 2026 config is in `src/config/term.local.ts` (gitignored) and stored in your settings row, so "Load Fall 2026 setup" still works. Edit the file and run `npm run term:upload` to change it. A fresh clone loads a made-up example term.
- **README** rewritten for a public repo.

Left for you (docs/BLOCKED.md, "Phase 10" entries):
1. The history fix in docs/AUDIT.md (Option A, a fresh single-commit history, is about 20 minutes), then make the repo public yourself.
2. Five README screenshots (list in docs/screenshots/README.md).
3. Only if you ever run `supabase config push`: set `APP_URL` and `AUTH_REDIRECT_URL` first.

Most likely to break first in the new pieces: a very large or unusual PDF whose pdf.js parse is slow enough to push a 10-second indexing step past Vercel's limit (it re-queues, but a single slow page repeats); heading detection on books that don't number their headings (the outline then shows "no numbered headings were found"); and the example term getting loaded by mistake if `settings.term_seed` is ever cleared (Settings, Term says so plainly).

## What works now

Checked on the hosted project with throwaway users (scripts in `.scratch/`, listed in `docs/PROGRESS.md`) and 320 unit tests.

- **Sign-in**: "Continue with Google" (Supabase Auth), only for the `ALLOWED_EMAIL` account; any other account sees "This app is private." (Replaced the email code on 2026-09-24.)
- **Term setup**: Settings, Term, "Load Fall 2026 setup" loads the four courses, 42 outline dates, grading schemes, policies, links, Quest class times, and watched pages. Pressing it again changes nothing.
- **Findability**: Today (runway list, next exam countdown, overdue items with the late policy, recent changes), Calendar (month, week, and list, with filters), course pages with eight tabs, an item drawer showing change history, quick add, and the command palette (Ctrl/Cmd+K or `/`) plus `/search` with aliases ("251 a1", "odysey").
- **CS 251 pages**: the schedule, exam info, and assignments pages sync on their cadence (once the scheduled jobs SQL is in; see below). Moves show in Updates, and a date you locked gets a proposal instead of an overwrite.
- **Paste inbox**: Quest and Odyssey pastes use rule-based parsers, with no AI. Outlines, announcements, and grades for STAT 230 go through Claude into a review queue. Nothing reaches your items without your approval.
- **Google Calendar**: reminders, prep days, and study blocks sync to a "Runway" calendar that Runway only ever writes differences to. It's built, but waits on the Connect click.
- **Digest and bridge routes**: the digest, ping, and email routes all check signatures. They wait on the Apps Script bridge.
- **Notes**: originals are stored byte for byte and can never be changed. STAT 230 notes also get a Claude-cleaned copy (after the Anthropic key works), a Compare view, and edit with live preview. Notes from AI-off courses are kept as-is.
- **Ask**: streaming answers with citations back to your notes, threads, scopes, and the graded-work policy banner. Only STAT 230 content is sent. Waits on the Anthropic key.
- **Piazza emails**: stored, filed by class, and listed in Updates. For STAT 230, a moved date becomes a proposal. Waits on the bridge and Piazza settings.
- **Phase 8 extras**:
  - Grades tab with the "what I need on the final" calculator.
  - Apple Calendar feed.
  - Data export zip and Delete a term.
  - Installable app (Today and Calendar work offline).
  - Odyssey userscript.
  - Claude connector (MCP) so Claude chats can read your deadlines and STAT 230 notes.
  - Hybrid search for Ask (waits on a Voyage key).
- **AI switch**: CS 245, CS 246, and CS 251 content never reaches Claude or Voyage. Tests prove this for every AI path, and the hosted checks look at the actual outgoing requests.

## What is parked, and why

Each item has a `docs/BLOCKED.md` entry naming the exact step.

| Item | Why it's parked | What it unblocks |
|---|---|---|
| Scheduled jobs SQL | Needs the Supabase SQL editor | Every scheduled sync, the job worker, calendar updates, and the nightly reconcile |
| Anthropic key | The key in `.env.local` isn't scoped to a workspace, so every call fails | STAT 230 extraction, note cleanup, Ask |
| Google Calendar connect | Needs a Google sign-in and publishing the OAuth app | Calendar sync and reminders |
| Apps Script bridge | Needs a Google sign-in at script.google.com | Digest email, Piazza emails |
| Piazza settings and class mapping | Needs a Piazza login | Piazza posts in Updates |
| LEARN feed URL | Needs a LEARN login | Hourly STAT 230 and CS 245 deadline sync |
| UW Open Data key | Needs email registration | Final exam schedule (published Oct 2) and UW important dates |
| Voyage AI key (optional) | `VOYAGE_API_KEY` in `.env.local` is empty | Hybrid search in Ask |
| Microsoft Graph (optional) | Needs a UW login with Duo, and UW may not allow it | Crowdmark emails without a paste |

## Manual steps left, in order

1. **Scheduled jobs SQL** (5 minutes): https://supabase.com/dashboard/project/<SUPABASE_PROJECT_REF>/sql/new. Paste "Scheduled jobs (step 5)" from `docs/SETUP.md`, using the production URL and `CRON_SECRET` from `.env.local`. Do this first; most other things run from it.
2. **Sign in and load the term** (3 minutes): <APP_URL>. Press "Continue with Google" and pick the `ALLOWED_EMAIL` account. Then go to Settings, Term and press "Load Fall 2026 setup".
3. **Sign in from the installed app** (2 minutes): open Runway from the iPhone home screen and press "Continue with Google" there too (docs/BLOCKED.md "Sign-in: first Google sign-in on the iPhone").
4. **Anthropic key** (10 minutes): https://platform.claude.com/settings/keys. Make a key inside a workspace and set a spend limit on that workspace. Replace `ANTHROPIC_API_KEY` in `.env.local`. Then have a local Claude Code session add it to Vercel, redeploy, and re-record fixtures with `.scratch/record-ai.ts`.
5. **Google Calendar** (10 minutes):
   - At https://console.cloud.google.com/auth/clients, check the redirect URI and scope, and publish the app.
   - Press "Connect Google Calendar" at <APP_URL>/settings/integrations.
   - Once the Runway calendar fills, delete the 49 stopgap events from Sep 17.
6. **Apps Script bridge** (15 minutes): https://script.google.com. Follow `docs/SETUP.md` step 8.
7. **Piazza** (10 minutes):
   - At https://piazza.com/account_settings, make your Gmail the preferred address and set Real Time emails in each class.
   - After the first emails arrive, pick a course for each Piazza class at <APP_URL>/settings/courses.
8. **LEARN feed** (5 minutes): https://learn.uwaterloo.ca/. In Calendar, Settings, turn on Enable Calendar Feeds, then Subscribe. Paste the URL into Settings, Integrations.
9. **UW Open Data key** (10 minutes): `docs/SETUP.md` step 4. Register at `https://openapi.data.uwaterloo.ca/v3/Account/Register`, then add `UW_OPENDATA_API_KEY` to Vercel.
10. **Copy `SUPABASE_DB_PASSWORD` into a password manager** (1 minute). If it's lost, it can only be reset, not recovered.
11. **Optional**:
    - Voyage key for hybrid search (10 minutes): https://dashboard.voyageai.com/, then Settings, AI, "Turn on hybrid search".
    - Install on the iPhone (1 minute): Safari, Share, Add to Home Screen.
    - Odyssey userscript (2 minutes): Tampermonkey, then Settings, Integrations.
    - Claude connector (2 minutes): Settings, Integrations, "Make connector link", then in Claude, Settings, Connectors.
    - Apple Calendar feed (1 minute).
    - Microsoft Graph: `docs/SETUP.md` step 10.

## Monthly cost to run

| Service | Plan | Expected |
|---|---|---|
| Vercel | Hobby | $0 |
| Supabase | Free (500 MB database, 1 GB storage) | $0 |
| Anthropic | Pay as you go, STAT 230 only | About $2 to $5: a few note cleanups a week and some Ask questions on Sonnet 5. Hard cap: `AI_MONTHLY_BUDGET_USD` ($8 in `.env.local`; the code default is $15). Past the cap, Ask switches to the extraction model and says so. |
| Voyage AI | Free tier (200M tokens a month) | $0. One term of notes is well under 1M tokens. |
| Google Calendar API, Apps Script, UW Open Data | Free | $0 |
| **Total** | | **About $2 to $5 a month, never more than the AI budget** |

## The three things most likely to break first

1. **CS 251 page parsers.** They read the course's HTML pages. If the course staff restructure a table, the sync fails, and Settings, Sync plus a Today banner (after three failures in a row) say so. Fix the parser in `src/lib/sources/cs251-*.ts` against a fresh capture in `tests/fixtures/pages/`.
2. **The Google Calendar token.** If the OAuth app stays in Testing, Google revokes the refresh token after 7 days. A revoked token marks the integration `reauth_required`, shows a reconnect banner, and stops calendar writes until you reconnect. Publishing the app (step 5) prevents the 7-day cutoff.
3. **Supabase free-tier pausing and the job worker.** A free project pauses after a week without activity. Without the scheduled jobs SQL (step 1), nothing keeps it active, and queued jobs (calendar updates, embeddings, summaries) only run when a page action triggers the worker. Installing the cron keeps both alive; if the project pauses anyway, restore it from the Supabase dashboard.

Close behind: the first live UW Open Data and Piazza emails may use formats the fixtures didn't cover. Settings, Sync and Settings, Courses ("waiting for a course") will show it.

## Choices made unattended, with the alternative

Every autopilot choice is in `docs/DECISIONS.md`, with an "Alternative" column. The ones most worth a second look:

- Calendar renders in the browser's time zone. The alternative is `@fullcalendar/luxon3`, for correct Toronto times when the phone is elsewhere.
- The MCP connector uses a secret URL, not OAuth. The alternative is a full OAuth server.
- In MCP answers, AI-off courses show schedule facts only, never notes or descriptions. The alternative is to leave them out entirely.
- Hybrid search's similarity floor (0.3) is a guess until a real Voyage key is tested.
- Phase 7 was built against fixtures instead of waiting for the bridge.

## Where to pick up

`docs/PROGRESS.md` has a map of where every phase's code lives, the scratch check scripts, and the "Later" list of ideas that were kept out of scope.
