# Setup

Claude Code does most of the setup from your computer. You approve logins, answer a few questions, and paste the handful of things no tool can fetch.

| Step | Who does it | When |
|---|---|---|
| 0. Stopgap | mostly done by Claude; two quick steps for you | today |
| 1. Setup session (Phases S and 0) | Claude Code on your computer, with your approvals | before building |
| 2. Cloud session environment | you, about 2 minutes | only if a cloud session must change the database |
| 3. LEARN feed URL | you, in Runway's settings | after Phase 2 |
| 4. UW Open Data key | Claude Code, with a code from your email | Phase 2 |
| 5. Scheduled jobs | Claude Code, in a local session | right after Phase 2 deploys |
| 6. Anthropic API key | you create it, Claude Code stores it | Phase 3 |
| 7. Google Calendar access | you, about 10 minutes | Phase 4 |
| 8. Apps Script bridge | you, about 5 minutes | Phase 4 |
| 9. Piazza | you | before Phase 7 |
| 10. Microsoft Graph (optional) | you | Phase 7 |

---

## 0. Stopgap (today)

Done on Sept 17: Claude added 49 events to your Google Calendar from the four outlines and the CS 251 pages. They cover every assignment, quiz, workshop, and midterm, plus Odyssey seat checks, reading week, the exam period, the Oct 2 exam schedule release, and the CS 251 end-of-term file deletion. Each has reminders. Delete them once Runway's calendar sync runs (Phase 4), or you'll see doubles.

Still yours:
1. **LEARN feed** (catches changes to STAT 230 and CS 245 dates). In LEARN: Calendar, Settings, turn on Enable Calendar Feeds. Then Subscribe, All Calendars and Tasks, and copy the URL. In Google Calendar on the web: Other calendars, the plus button, From URL, paste. Google refreshes these feeds slowly (up to a day).
2. **Piazza.** In Piazza account settings, add your Gmail and make it the preferred address. In each of the four classes, set email notifications to Real Time, at least for instructor posts.
3. **CS 245 midterm date.** The outline lists both Thursday, Oct 29 and "Tuesday, October 28" (a Wednesday this year). The calendar uses Oct 29; confirm on LEARN.
4. **STAT 230 tutorial section.** Workshop and quiz events span 2:30 to 4:20 pm because the time depends on your section. Tell Claude your section to tighten them.

## 1. Setup session (Phases S and 0)

1. Download `runway-kit.zip` and unzip it. (Use the newest download; the kit changed on Sept 17.) You get a folder named `runway`.
2. Open that folder in Claude Code on your computer: the desktop app's Code tab with a local folder, or `claude` in a terminal inside the folder.
3. Paste:
   ```
   Read CLAUDE.md, then do Phase S and then Phase 0 from docs/PHASES.md.
   Ask me before creating anything in my accounts, and never show secrets in chat.
   ```
4. Stay nearby for about an hour. Claude Code will ask you to:
   - approve three browser logins (GitHub, Supabase, Vercel);
   - give the email you'll sign in with (use the one on your Supabase account);
   - confirm before it creates the GitHub repo, the Supabase project, and the Vercel project;
   - approve installing the GitHub command-line tool, if you don't have it;
   - copy the database password from `.env.local` into your password manager;
   - sign in to the finished app with "Continue with Google", using the Google account whose email is `ALLOWED_EMAIL`.

Everything it creates is private: a private repo, a new free Supabase project in ca-central-1, and a Vercel project on your existing account. Supabase's free plan allows two active projects. If you already have two, Claude Code stops and asks.

To do this step by hand instead, follow "Manual setup" near the end of this file.

## 2. Cloud session environment (optional)

Cloud sessions reach package registries and not much else, so they can't touch your database. Phases 1 to 7 only change code, so the default environment works; builds there run with `SKIP_ENV_VALIDATION=1`. Set up an environment if you want a cloud session to change the database (Phase 8's embeddings, for example):

1. At https://claude.ai/code, open the environment selector (the cloud icon above the message box) and add an environment named `runway`.
2. Network access: Custom, allowing `*.supabase.co` and `api.supabase.com`, with the default package manager list included.
3. Environment variables:
   ```
   SUPABASE_ACCESS_TOKEN=...   # Supabase dashboard, account menu, Access Tokens
   SUPABASE_PROJECT_REF=...    # recorded in docs/PROGRESS.md by Phase S
   SKIP_ENV_VALIDATION=1
   ```
4. Pick `runway` before starting a session. If Supabase requests fail with "Host not in allowlist", run `echo $CLAUDE_CODE_ENVIRONMENT_NAME` in the session to see which environment it got.

Variables from this panel reach the running session but not the environment's setup script.

## 3. LEARN feed URL (after Phase 2)

Paste the feed URL from step 0.3 into Runway, Settings, Integrations. Treat it like a password. If it leaks, turn feeds off and on again in LEARN to get a new one.

## 4. UW Open Data key (Phase 2)

Ask Claude Code, in a local session, to register the key. It runs:
```
curl -X POST "https://openapi.data.uwaterloo.ca/v3/Account/Register?email=YOUR_EMAIL&project=Runway&uri=YOUR_APP_URL"
```
A code arrives by email. Give it to Claude Code, which calls `POST /v3/Account/Confirm?email=...&code=...`, then stores the key as `UW_OPENDATA_API_KEY` in `.env.local` and Vercel. The exam schedule endpoint stays empty until October 2, 2026. Live API docs: https://openapi.data.uwaterloo.ca/api-docs/index.html

## 5. Scheduled jobs (right after Phase 2 deploys)

In a local session, Claude Code runs the "Scheduled jobs" snippet below with `npx supabase db query`, filling in the app URL and `CRON_SECRET` from `.env.local`. You can also paste it into the Supabase SQL editor yourself. A few minutes later, run the "Check scheduled jobs" snippet.

## 6. Anthropic API key (Phase 3)

Create a key inside a workspace in the Claude Console and set a monthly spend limit there. A key that isn't scoped to a workspace also needs `ANTHROPIC_WORKSPACE_ID`. Paste the key into `.env.local` as `ANTHROPIC_API_KEY`, then ask Claude Code (local session) to add it to Vercel. Phase 3 fills `src/lib/ai/pricing.ts` from the API pricing page; check the numbers once.

## 7. Google Calendar access (Phase 4)

1. At https://console.cloud.google.com, create a project named `Runway` and enable the **Google Calendar API**.
2. Google Auth Platform (older consoles call it the OAuth consent screen):
   - Branding: app name Runway, your email as support and developer contact.
   - Audience: External.
   - Data Access: add `https://www.googleapis.com/auth/calendar.app.created`, which covers only the calendars Runway creates.
3. Clients, Create client, Web application. Redirect URIs: `https://YOUR-APP.vercel.app/api/gcal/callback` and `http://localhost:3000/api/gcal/callback`.
4. Paste the client ID and secret into `.env.local` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, and ask Claude Code to add them to Vercel.
5. Audience, **Publish app**. Apps left in Testing get refresh tokens that expire after 7 days, which would break calendar sync every week. Consent will warn that the app is unverified; choose Advanced, then continue. That's expected for a personal app.

## 8. Apps Script bridge (Phase 4)

1. At https://script.google.com, create a project named `Runway bridge`.
2. Replace `Code.gs` with `scripts/apps-script/Code.gs` from the repo.
3. Project Settings: time zone America/Toronto. Script properties: `RUNWAY_URL` (your app URL, no trailing slash), `RUNWAY_SECRET` (the `INGEST_WEBHOOK_SECRET` value from `.env.local`), `DIGEST_TO` (where the digest goes).
4. Pick `setup` in the function menu, click Run, and approve the permissions. Your own script shows the unverified warning too.
5. Check Executions for errors and Triggers for `syncPiazza` (every 15 minutes) and `sendDigest` (daily, 8 to 9 am). Runway, Settings, Integrations should show a recent ping.

## 9. Piazza (before Phase 7)

The email settings from step 0.4 must be on. After Phase 7 ships, pick the course for each class in Runway, Settings, Courses:
- https://piazza.com/class/<PIAZZA_CLASS_1>
- https://piazza.com/class/<PIAZZA_CLASS_2>
- https://piazza.com/class/<PIAZZA_CLASS_3>
- https://piazza.com/class/<PIAZZA_CLASS_4>

## 10. Microsoft Graph for Crowdmark emails (optional, Phase 7)

1. At https://entra.microsoft.com: App registrations, New registration. Supported accounts: any organizational directory. Redirect URI (Web): `https://YOUR-APP.vercel.app/api/ms/callback`.
2. API permissions: Microsoft Graph, delegated, `Mail.Read` and `offline_access`.
3. Sign in with your UW account from Runway. If Microsoft says the app needs admin approval, stop there. Crowdmark stays a paste reminder, and PROGRESS.md records the result.

---

## SQL snippets

### RLS check (Phase S runs this; expect no rows)
```sql
select relname from pg_class
where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity;
```

### Storage bucket (Phase S runs this)
```sql
insert into storage.buckets (id, name, public) values ('library', 'library', false)
on conflict (id) do nothing;

create policy "library read own" on storage.objects for select to authenticated
  using (bucket_id = 'library' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "library write own" on storage.objects for insert to authenticated
  with check (bucket_id = 'library' and (storage.foldername(name))[1] = (select auth.uid()::text));
```

### Scheduled jobs (step 5)
```sql
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select vault.create_secret('https://YOUR-APP.vercel.app', 'runway_app_url');
select vault.create_secret('YOUR_CRON_SECRET', 'runway_cron_secret');

create or replace function public.runway_call(path text)
returns bigint
language sql
security definer
set search_path = ''
as $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'runway_app_url') || path,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'runway_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
$$;
revoke execute on function public.runway_call(text) from public, anon, authenticated;

-- Cron times are UTC. 10:27 UTC is about 6:27 am in Toronto.
select cron.schedule('runway-jobs',        '* * * * *',    $$ select public.runway_call('/api/jobs/run') $$);
select cron.schedule('runway-sync-hourly', '7 * * * *',    $$ select public.runway_call('/api/cron/sync?set=hourly') $$);
select cron.schedule('runway-sync-3h',     '17 */3 * * *', $$ select public.runway_call('/api/cron/sync?set=every_3h') $$);
select cron.schedule('runway-sync-daily',  '27 10 * * *',  $$ select public.runway_call('/api/cron/sync?set=daily') $$);
```

### Check scheduled jobs
```sql
select jobname, schedule, active from cron.job;
select status_code, created from net._http_response order by created desc limit 5;
```
Status 202 or 200 means Runway accepted the call. 401 means the Vault secret doesn't match `CRON_SECRET`.

---

## Manual setup (if you skip the setup session)

1. **GitHub**: create a private repo named `runway` and push the unzipped folder with git. The web uploader can skip the hidden `.claude` folder.
2. **Supabase**: create a project in ca-central-1. In the SQL Editor, run `supabase/migrations/20260915000000_init.sql`, then the RLS check and storage snippets. From Project Settings, API Keys, copy the URL, publishable key, and secret key. Under Authentication, URL Configuration, set the site URL to your Vercel URL and add `http://localhost:3000/**` and `https://YOUR-APP.vercel.app/**` as redirect URLs. Under Authentication, Emails, add `{{ .Token }}` to the Magic Link template.
3. **Vercel**: import the repo and add the variables below.
4. **Local**: copy `.env.example` to `.env.local` and fill it in.

| Var | Value | Phase |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | 0 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key | 0 |
| `SUPABASE_SECRET_KEY` | Supabase secret key (server only) | 0 |
| `APP_URL` | `https://YOUR-APP.vercel.app` | 0 |
| `ALLOWED_EMAIL` | the email on your Supabase account | 0 |
| `CRON_SECRET` | random hex | 2 |
| `TOKEN_ENCRYPTION_KEY` | random base64 | 2 |
| `UW_OPENDATA_API_KEY` | step 4 | 2 |
| `ANTHROPIC_API_KEY` | step 6 | 3 |
| `ANTHROPIC_WORKSPACE_ID` | only for a key that is not scoped to a workspace | 3 |
| `AI_MONTHLY_BUDGET_USD` | for example `15` | 3 |
| `MODEL_EXTRACT`, `MODEL_CLEANUP`, `MODEL_ASK`, `MODEL_ASK_DEEP` | optional overrides (defaults in PROMPTS.md) | 3 |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | step 7 | 4 |
| `INGEST_WEBHOOK_SECRET` | random hex; the same value goes in the Apps Script | 4 |
| `MS_CLIENT_ID`, `MS_TENANT` | optional, step 10 | 7 |
| `VOYAGE_API_KEY` | optional | 8 |

Random values:
```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| The sign-in code never arrives | The address isn't a member of your Supabase organization, or the 2-per-hour cap was hit | Use your Supabase account email, or wait an hour |
| Sign-in loops back to /login | Redirect URLs don't include the production URL | Set them in `supabase/config.toml` and run `npx supabase config push` |
| Calendar sync stops about a week after connecting | The Google app is still in Testing | Step 7.5, then reconnect in Settings |
| Nothing syncs on schedule | Cron isn't firing, or the secret is wrong | Run "Check scheduled jobs" |
| The bridge gets 401 | `RUNWAY_SECRET` differs from `INGEST_WEBHOOK_SECRET` | Copy the value again, then run `ping` |
| LEARN sync finds nothing | Instructors haven't put dates on the LEARN calendar | Paste the outline and watch the coverage meter |
| The exam schedule is empty | It's before October 2, 2026 | Nothing to fix |
| A cloud session can't reach Supabase | It's using the default environment | Step 2, or do database work in a local session |
