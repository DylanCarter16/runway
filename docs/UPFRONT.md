# Upfront setup, then hands off

About 45 minutes of dashboard work, one command, then nothing until it stops.

## A. Before you start

Everything here ends up as a line in `.env.local` at the repo root. The autopilot copies them into Vercel itself.

**1. Anthropic API key (5 min).** Create a key in the Claude Console, add credit, and set a monthly spend limit there. The app needs it from Phase 3, and the autopilot falls back to it if your Max plan lapses mid-run.
```
ANTHROPIC_API_KEY=sk-ant-...
AI_MONTHLY_BUDGET_USD=15
```

**2. Google Cloud (15 min).** At console.cloud.google.com, create a project named Runway and enable the **Google Calendar API**. Under Google Auth Platform: Branding (app name Runway, your email), Audience set to External, Data access with `openid`, `userinfo.email`, `userinfo.profile`, and `https://www.googleapis.com/auth/calendar.app.created`. Then Clients, Create client, Web application, with these redirect URIs:
```
https://<your-supabase-ref>.supabase.co/auth/v1/callback
<APP_URL>/api/gcal/callback
http://localhost:3000/api/gcal/callback
```
Finish with Audience, **Publish app**. Skipping that makes calendar sync die every 7 days.
```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

**3. Supabase (5 min).** Authentication, Sign In / Providers, Google: turn it on and paste the same client ID and secret. Under URL Configuration, Site URL is the Vercel URL, and the redirect list holds `<APP_URL>/**` and `http://localhost:3000/**`. This also replaces the 6-digit code sign-in that the free email sender can't support.

**4. UW Open Data key (5 min).**
```
curl -X POST "https://openapi.data.uwaterloo.ca/v3/Account/Register?email=YOUR_EMAIL&project=Runway&uri=<APP_URL>"
curl -X POST "https://openapi.data.uwaterloo.ca/v3/Account/Confirm?email=YOUR_EMAIL&code=CODE_FROM_EMAIL"
```
```
UW_OPENDATA_API_KEY=...
```

**5. LEARN feed URL (5 min).** LEARN, Calendar, Settings, turn on Enable Calendar Feeds. Subscribe, All Calendars and Tasks, copy the URL.
```
LEARN_ICS_URL=https://learn.uwaterloo.ca/d2l/le/calendar/feed/user/feed.ics?token=...
```

**6. Piazza (5 min).** Account settings: add your Gmail and make it preferred. In each of the four classes, set email notifications to Real Time for instructor posts.

**7. Secrets that should already exist.** Check `.env.local` has `CRON_SECRET`, `INGEST_WEBHOOK_SECRET`, and `TOKEN_ENCRYPTION_KEY` from Phase S. Generate any that are missing:
```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**8. Keep the machine awake.** Plug it in, then in an admin PowerShell:
```
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
```

## B. Start the run

From the repo root, in a normal terminal (not a background job):

```
git pull
node scripts/autopilot/autopilot.mjs --budget 75 --max-cycles 40
```

Leave the window open. Each session reads `docs/PROGRESS.md`, does the next phase, commits, pushes, and exits. The runner logs to `docs/autopilot-log.md`, writes `.autopilot/status.json` after every session, waits out rate limits, and stops on any of: `.autopilot/DONE`, the budget, 40 sessions, or three failures in a row.

To stop it early, press Ctrl-C or create the file `.autopilot/STOP`.

To check progress from your phone: the commits land on GitHub, so the repo's commit list is your status board.

## C. When it stops (about 15 minutes)

Read `docs/HANDOFF.md` first, then `docs/BLOCKED.md`. These are the steps no agent can do:

1. **Connect Google Calendar** in the app: Settings, Integrations, Connect. One consent screen.
2. **Install the Apps Script bridge**: script.google.com, new project, paste `scripts/apps-script/Code.gs`, set the three script properties, run `setup`, approve. This turns on Piazza ingest and the morning digest.
3. **Map the four Piazza classes** to courses in Settings, Courses.
4. **Delete the 49 manual calendar events** I added in September, since Runway now writes its own calendar.
5. **Flip the AI switch** for any course where you want cleaned notes and Ask.

## What this cannot do

- Any browser login (Google consent, WatIAM, Duo, Piazza).
- Decide a product question that the phase docs don't answer. It parks those in `docs/BLOCKED.md` instead of guessing.
- Guarantee correctness. It keeps the suite green and the build passing, which catches broken code, not wrong behaviour. Budget an hour to click through the finished app.
