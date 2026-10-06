# Blocked

Items parked during autopilot runs (docs/AUTOPILOT.md). Each needs one human step; the code behind it is built and tested.

## Sign-in: first Google sign-in on the iPhone
- Needed: (1) In Safari on the iPhone, open <APP_URL>/login, press "Continue with Google", and pick the Google account whose email is `ALLOWED_EMAIL`. You should land on Today. (2) Open the installed Runway app from the home screen (if Safari was signed in first, sign out in the app, or delete and re-add it; the home-screen app keeps its own cookies apart from Safari). Press "Continue with Google" there too. Google opens inside the app; after you pick the account you should land on Today inside the app, not in Safari. (3) Report what happened. "Sign-in didn't finish. Try again." in the app means the code exchange couldn't find its PKCE cookie, so iOS opened Google in a browser that doesn't share the app's cookies. That needs a follow-up change. (4) If Google says access is blocked, add your address as a test user on the Google Cloud Audience page, or publish the app (the Phase 4 entry below).
- Why: the code, the callback, and the redirect to Google are checked live, but only a real Google account on the real phone can finish the round trip, and iOS home-screen apps handle pages outside their scope (accounts.google.com) differently from a Safari tab.
- Done so far: deployed to production 2026-09-24. `/login` shows the button, `/auth/callback` answers signed out, and Supabase hands off to Google's sign-in page with the `https://<SUPABASE_PROJECT_REF>.supabase.co/auth/v1/callback` redirect URI accepted. Unit tests cover the exchange, the private sign-out, a failed exchange, and the proxy gate. If the Google account's email matches the account made by the old email code, Supabase links the two, so existing data stays with you.
- Time: 3 minutes.

## Phase 2: UW Open Data key
- Needed: register for a key (docs/SETUP.md step 4: `POST https://openapi.data.uwaterloo.ca/v3/Account/Register?email=...&project=Runway&uri=<APP_URL>`, then confirm with the emailed code at `/v3/Account/Confirm`). Put it in `.env.local` and in Vercel as `UW_OPENDATA_API_KEY` (production and preview, sensitive), then redeploy.
- Why: unblocks the daily sync of final exams (published Oct 2, 2026) and UW important dates.
- Done so far: `src/lib/sources/open-data.ts` (mappers for terms, important dates, and exam schedules, tested against synthetic fixtures in `tests/fixtures/sources/`), the `sync.open_data` job, the daily cron entry, and the Settings, Sync row. Without the key the source is skipped, not failed. The field names follow SOURCES.md; the first live run may show a format the fixtures didn't cover, so check Settings, Sync after it.
- Time: 10 minutes.

## Phase 2: LEARN feed URL
- Needed: in LEARN (https://learn.uwaterloo.ca/), open Calendar, then Settings, and turn on "Enable Calendar Feeds". Then Subscribe, choose "All Calendars and Tasks", copy the URL, and paste it into Runway at Settings, Integrations, LEARN feed (<APP_URL>/settings/integrations).
- Why: STAT 230 and CS 245 deadlines from LEARN sync every hour.
- Done so far: parser (`src/lib/sources/learn-ics.ts`, tested against a synthetic feed), encrypted storage, the hourly `sync.learn_ics` job, unmatched events go to the review queue, and removed events are marked "no longer appears on its source". Saving the URL starts the first sync at once.
- Time: 5 minutes.

## Phase 2: scheduled jobs SQL
- Needed: run the "Scheduled jobs (step 5)" SQL from docs/SETUP.md in the Supabase SQL editor (https://supabase.com/dashboard/project/<SUPABASE_PROJECT_REF>/sql/new), with the production URL `<APP_URL>` and the `CRON_SECRET` value from `.env.local`.
- Why: without it nothing runs on schedule; syncs only run from Settings, Sync, "Run now". Since Phase 4 it also drives Google Calendar: item and reminder changes queue jobs, and only this per-minute worker (or "Sync calendar now") runs them, so without it calendar updates wait for a button press. The daily run also refreshes paste reminders and reconciles the calendar.
- Done so far: `/api/cron/sync` and `/api/jobs/run` are deployed and answer 401 without the secret and 202 with it (checked 2026-09-23).
- Time: 5 minutes.

## Phase 3: Anthropic API key can't make calls yet
- Update 2026-09-24: the key in `.env.local` works now (a test call and the Phase 9 transcription recordings succeeded). What may remain: make sure Vercel has the same key (production and preview), then redeploy. Phase 9 file transcription needs it too.
- Needed: the key in `.env.local` is not scoped to a workspace, so the API answers "This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header". Either create a new key inside a workspace in the Claude Console (https://platform.claude.com/settings/keys, pick a workspace when creating it) and replace `ANTHROPIC_API_KEY` in `.env.local`, or keep the key and add `ANTHROPIC_WORKSPACE_ID=<workspace id>` (from https://platform.claude.com/settings/workspaces) to `.env.local`. Set a monthly spend limit on the workspace. Then ask a local Claude Code session to add `ANTHROPIC_API_KEY` (and `ANTHROPIC_WORKSPACE_ID` if used) to Vercel (production and preview, sensitive) and redeploy, and to re-record the AI fixtures with `.scratch/record-ai.ts`.
- Why: unblocks Claude extraction for STAT 230 pastes (outlines, announcements, grades, assignment headers) and page change summaries. Phase 5 note cleanup and Phase 6 Ask wait on it too: `/api/ask` answers 503 "Claude isn't set up yet" and the Ask page says so, until the key is in Vercel. Rule-based pastes (Quest schedules, Odyssey rows) and AI-off courses work without it.
- Done so far: the whole pipeline (`src/lib/ai`, `src/lib/inbox`, `src/lib/jobs/inbox.ts`) is built and tested against hand-written responses in `tests/fixtures/ai/`. Without a working key, STAT 230 pastes are stored with the note "Claude is not set up yet" (production has no key yet) or, locally, fail after three tries and show "Reading it failed" in the Library.
- Time: 10 minutes.

## Phase 4: connect Google Calendar
- Needed: (1) In Google Cloud (https://console.cloud.google.com/auth/clients), check the OAuth client lists the redirect URI `<APP_URL>/api/gcal/callback` (and `http://localhost:3000/api/gcal/callback`), and that the Data Access page has `https://www.googleapis.com/auth/calendar.app.created`. (2) Audience page: press **Publish app** if it still says Testing (docs/SETUP.md step 7.5), or the refresh token dies after 7 days. (3) Sign in at <APP_URL>/settings/integrations and press "Connect Google Calendar". Choose Advanced, then continue, on the unverified-app warning.
- Why: every dated item, prep block, study block, and paste reminder then goes to a calendar named Runway with its reminders. Once it syncs, delete the 49 stopgap events from 2026-09-17.
- Done so far: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are in Vercel (production and preview). OAuth connect and callback, encrypted refresh token, the Runway calendar, the reconcile sync, reconnect handling, and the Settings and Today UI are deployed. Checked against the hosted database with a fake calendar (`.scratch/phase4.ts`): first run 102 events, second run no writes; quick add, date move, submit, and dismiss each write exactly what they should. Not checked live: the real Google API (needs this click), and "still syncs after 7 days".
- Time: 10 minutes.

## Phase 4: Apps Script bridge
- Needed: docs/SETUP.md step 8 at https://script.google.com: new project "Runway bridge", paste `scripts/apps-script/Code.gs`, set time zone America/Toronto, add Script properties `RUNWAY_URL` = `<APP_URL>`, `RUNWAY_SECRET` = the `INGEST_WEBHOOK_SECRET` value from `.env.local`, `DIGEST_TO` = your email, then run `setup` and approve.
- Why: the morning digest email and Piazza emails (Phase 7 is built and waiting on this). Settings, Integrations shows the ping, the last email check, and the last email when it works.
- Done so far: `POST /api/ingest/ping`, `GET /api/digest`, and `POST /api/ingest/email` (real since Phase 7) verify the HMAC signature and reject anything over 5 minutes old (checked: bad signature, old timestamp, and no headers all get 401; signed requests get 200 and 202). The digest content is tested with fixtures.
- Time: 15 minutes.

## Phase 7: Piazza email settings and class mapping
- Needed: (1) docs/SETUP.md step 9 (and step 0.2): in Piazza account settings (https://piazza.com/account_settings) add your Gmail and make it the preferred address; in each of the four classes set email notifications to Real Time, at least for instructor posts. (2) After the bridge is installed (entry above), open <APP_URL>/settings/courses, and under "Piazza classes" pick the course for each class link (open each link to see which course it is), then press "Save Piazza classes".
- Why: Piazza posts arrive every 15 minutes, show in each course's Updates with a link to the post, and for STAT 230 (AI on) a moved date becomes a proposal in the Inbox. Emails from a class with no course are stored and wait; saving the mapping files them.
- Done so far: `POST /api/ingest/email` stores each new message as a `piazza_email` document (Gmail ids already stored are skipped), queues extraction, and chunks it for Ask; the Piazza prompt path, the mapping form, Updates entries (noise hidden behind a toggle), and the last email in Settings, Integrations. Checked with fixtures (`tests/lib/ingest/`) and on the hosted project with a throwaway user (`.scratch/phase7.ts`, 72 checks). Not checked live: a real Piazza email's format; if its links don't contain `/class/<id>`, emails stay without a course (Settings, Courses shows "waiting for a course").
- Time: 10 minutes.

## Phase 7 (optional): Microsoft Graph for Crowdmark emails
- Needed: only if you want Crowdmark emails from your UW inbox read automatically: docs/SETUP.md step 10 (an Entra app with delegated `Mail.Read`, which UW may require admin consent for). Then ask a local session to run the 1-hour spike in PHASES.md Phase 7 task 5.
- Why: Crowdmark assessment links and due dates would arrive without a paste. Without it, the paste reminder for Crowdmark stays the way in.
- Done so far: nothing; the spike needs a UW Microsoft login with Duo.
- Time: 30 minutes, and it may not be allowed by UW.

## Phase 8: Voyage AI key for hybrid search
- Needed: make a key at https://dashboard.voyageai.com/ (API keys; the first 200M tokens a month are free, and a payment method lifts the low free-tier rate limits). Put it in `.env.local` as `VOYAGE_API_KEY` (the line is there but empty), then ask a local Claude Code session to add it to Vercel (production and preview, sensitive), redeploy, and run `.scratch/record-embeddings.ts` to check the similarity floor (`MIN_SIMILARITY` in `src/lib/search/hybrid.ts`) against real voyage-4 answers. Then open <APP_URL>/settings/ai and press "Turn on hybrid search".
- Why: Ask then also finds passages that say the same thing in other words (a question about "disjoint outcomes" finds the notes on mutually exclusive events). Only STAT 230 passages (AI on) are embedded. Ask works without it, by words only.
- Done so far: migration `20260923182414_hybrid_search.sql` (pgvector `chunks.embedding`, `match_chunks`, `settings.ask_hybrid_search`, a trigger that queues the embedding job), the Voyage client with the AI switch gate and `ai_calls` logging, the `embeddings.chunks` job, rank fusion in Ask's search, and the Settings, AI block (it says "Not set up" until the key is in Vercel). Checked with synthetic vectors: 15 unit tests and `.scratch/phase8-hybrid.ts` (33 checks on the hosted project). Not checked live: a real Voyage call.
- Time: 10 minutes.

## Phase 10: history fix, then make the repo public
- Needed: pick Option A (fresh single-commit history, recommended) or Option B (`git filter-repo`) in docs/AUDIT.md, "History fix: exact commands", and run it. Then fill in the five README screenshots (docs/screenshots/README.md lists them) and change visibility yourself: https://github.com/DylanCarter16/runway/settings (General, Danger Zone).
- Why: no secret was ever committed (nothing to rotate), but history still holds the Supabase project ref, the production URL, your commit email, the four Piazza class ids, and the real term (sections and rooms). Tracked files no longer do.
- Done so far: audit (docs/AUDIT.md), personal values replaced with placeholders in every tracked file, the real term moved to the gitignored `src/config/term.local.ts` and stored in your settings row, public README.
- Time: 20 minutes, plus screenshots.

## Phase 10: before any `supabase config push`
- Needed: `supabase/config.toml` now reads `site_url` from `APP_URL` and the redirect allow-list from `AUTH_REDIRECT_URL` (your production URL followed by `/**`). Set both in your shell before running `npx supabase config push`. Nothing to do otherwise; the hosted project's auth URLs are already set in the dashboard.
- Why: the repo holds no hosted address any more.
- Done so far: config.toml changed; no config push was run.
- Time: 1 minute, only if you push config.

## Phase 10: long uploads need the scheduled worker
- Needed: nothing new; the "Phase 2: scheduled jobs SQL" entry above. A textbook indexes in 150-page steps inside the upload's own worker run (45 seconds); a book too big to finish there continues on the per-minute cron, which isn't set up yet.
- Why: 500 to 900-page books finish in one run in testing (520 pages in 8 seconds locally), but a slow day on Vercel could leave the rest waiting for the cron or for the next upload.
- Done so far: indexing re-queues itself and shows progress ("Indexed 300 of 840 pages").
- Time: covered by the scheduled jobs entry.
