# Secrets audit (Phase 10, Task 1)

Run 2026-10-06 by the autopilot in a local session, before the repo goes public. This report holds names, files, and commits only. No secret value appears here.

## Result

**No secret was ever committed.** No API key, password, signing secret, encryption key, OAuth secret, LEARN feed token, or Vercel token appears in any commit, commit message, or dangling object. Nothing needs rotating.

What history does hold is personal identifiers: the Supabase project ref and host, the production URL, Dylan's commit email, Piazza class ids, and the real term (sections, rooms, staff). None of them grants access on its own, so they're handled by Task 5 (move them out of tracked files) and one history fix at the end of the phase (below).

## How the scan ran

- Scope: every commit reachable from every ref (`main`, `phase-9`, `worktree-google-signin`, `worktree-phase-10-plan`, and their `origin/` copies), plus 4 dangling commits and 1 dangling blob from `git fsck --lost-found`. 97 commits and 685 blobs in total, every blob read in full, plus every commit message.
- Tool: `.scratch/audit.py` (gitignored, run with `python -I`). gitleaks wasn't installed and nobody was there to agree to installing it, so the script does both of its jobs itself:
  - **Exact values**: every non-empty value in `.env.local` except the model names, the budget, and `MS_TENANT` (not secret), compared byte for byte against every blob: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_DB_PASSWORD` (plain and URL-encoded), `SUPABASE_PROJECT_REF`, `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `CRON_SECRET`, `INGEST_WEBHOOK_SECRET`, `TOKEN_ENCRYPTION_KEY`, `UW_OPENDATA_API_KEY`, `VERCEL_OIDC_TOKEN`, `APP_URL` and its host, `ALLOWED_EMAIL`, `LEARN_ICS_URL` and its `token` parameter alone, plus Dylan's git author email and GitHub username. `VOYAGE_API_KEY` and `MS_CLIENT_ID` are empty in `.env.local`, so the shape patterns cover them. `ANTHROPIC_WORKSPACE_ID` isn't in `.env.local`.
  - **Shapes**: Anthropic (`sk-ant-`), Supabase secret and publishable (`sb_secret_`, `sb_publishable_`), JWTs (legacy Supabase keys), Google client secret (`GOCSPX-`) and API key (`AIza`), Voyage (`pa-`), GitHub (`ghp_` and friends), Vercel (`vercel_`), private key blocks, Postgres URLs with a password, LEARN feed URLs with a token, and long hex strings (48+ characters).
- MCP, feed, and Odyssey tokens are generated at runtime and stored only as hashes in the database, so they have no value to grep for; the shape patterns found none in history.
- Paths checked in history: `.env*` (only `.env.example`, which holds names and no values), `.scratch/` and `.autopilot/` (never committed), `docs/`, `tests/fixtures/`, `scripts/apps-script/Code.gs`, `scripts/autopilot/`, `supabase/config.toml`, `.claude/rules/`, and `.github/workflows/ci.yml` (uses no secrets at all; it builds with `SKIP_ENV_VALIDATION`).

## Findings

| # | What | Where now | First commit | Secret? | Fix |
|---|---|---|---|---|---|
| 1 | Supabase project ref | `docs/BLOCKED.md`, `docs/HANDOFF.md`, `docs/PROGRESS.md` | `f7a4554` (2026-09-17) | No. It's in the public browser bundle anyway. | Task 5 placeholders, then the history fix |
| 2 | Supabase host (`NEXT_PUBLIC_SUPABASE_URL`) | `docs/BLOCKED.md` | `8335cc0` (2026-09-24) | No (public in the browser bundle) | Task 5, history fix |
| 3 | Production URL and host (`APP_URL`) | `docs/BLOCKED.md`, `HANDOFF.md`, `PROGRESS.md`, `UPFRONT.md`, `autopilot-log.md`, `scripts/autopilot/settings.json`, `supabase/config.toml` (`site_url`, `additional_redirect_urls`); also one dangling local blob | `46b6965` (2026-09-17) | No | Task 5 (config.toml reads it from env), history fix |
| 4 | Dylan's commit email | Author and committer of all 90 commits; not in any file | every commit | No, but personal | History fix: rewrite authors to the GitHub noreply address, or publish a fresh history committed with it. Set `git config user.email` to the noreply address first |
| 5 | GitHub username | `docs/PROGRESS.md`, one commit message (`f7a4554`) | `f7a4554` | No. It's public the moment the repo is | Fine to keep |
| 6 | Four Piazza class ids | `src/config/term-f26.ts`, `docs/SETUP.md`, `docs/SOURCES.md`, `src/lib/sources/email.ts`, `tests/lib/ingest/email-store.ts`, `tests/fixtures/email/piazza-batch.json`, two `tests/fixtures/ai/stat230-piazza-*.response.json` | `bc329e1` (2026-09-17) | No, but they identify Dylan's classes | Task 5: env and DB only; fixtures get made-up ids; history fix |
| 7 | Dylan's real term: sections, tutorial rooms, and times | `src/config/term-f26.ts` | `bc329e1` | No, but it says where Dylan is every week | Task 5 (gitignored local config), history fix |
| 8 | Course staff names, UW emails, and offices | `src/config/term-f26.ts`, `docs/SOURCES.md` | `bc329e1` | No. Published by UW on course pages and outlines | Task 5 moves them out with the term config |
| 9 | Dangling local objects (4 commits, 1 blob) | Local `.git` only; never pushed | n/a | No secrets in them | `git gc --prune=now` before any fresh push; nothing to do for GitHub |

`ALLOWED_EMAIL` does not appear in any file or commit.

## Fine to publish

- All code, migrations, tests, and the docs once Task 5 swaps in placeholders.
- `.env.example` (names only).
- `.github/workflows/ci.yml` (no secrets).
- `scripts/apps-script/Code.gs` (its header uses a made-up example URL).
- `tests/fixtures/`: the STAT 230 note, outline, and announcement text (STAT 230 allows AI; these are short study notes and an outline summary), the CS 251 page snapshots (public course web pages), the LEARN feed fixture (fake ids on a `learn.example` host), the Quest and Odyssey pastes (made-up instructors; the Odyssey one has a sample seat number), and the grade pastes (made-up marks recorded before those assessments happened).
- The GitHub username, the course codes, the term, and the course website URLs.
- `docs/AUTOPILOT.md` and the phase docs.

## Remove before publishing

1. The project ref, Supabase host, and production URL from tracked files (Task 5, step 3), including `supabase/config.toml` and `scripts/autopilot/settings.json`.
2. The four Piazza class ids from code, docs, tests, and fixtures (Task 5, step 2).
3. The real term config (`src/config/term-f26.ts`) out of git; a made-up example term in its place (Task 5, step 1).
4. All of the above from history, plus the commit email: one history fix after Task 5. Two options, Dylan picks:
   - **Fresh single-commit history (recommended)**: a new repo, or an orphan branch force-pushed to `main`, with one commit of the cleaned tree, authored with the GitHub noreply email. Simplest, and nothing personal can survive in an old blob. The private repo can stay as Dylan's archive.
   - **`git filter-repo`**: keeps the commit-by-commit build story, which suits a repo that shows off an overnight autopilot build. Needs `--replace-text` for the ref, host, URL, and Piazza ids, `--path src/config/term-f26.ts --invert-paths`, and `--mailmap` for the email. Every old branch goes or gets rewritten too.

Task 5 writes out the exact commands for whichever option and stops before running them. Rewriting and force-pushing wait for Dylan.

## Nothing to rotate

No secret was ever committed, so no key needs rotating because of the repo. Two things are worth doing anyway before the repo goes public, since they cost a minute each:

- Confirm the Vercel env has the same values as `.env.local` and nothing was pasted into a GitHub issue, PR, or Actions log (outside git; this scan can't see it). GitHub: Settings, Secrets and variables, Actions can be empty, since `ci.yml` uses none.
- The scan only proves the repo is clean. Secrets also live in `.env.local` on this machine, in Vercel, in Supabase Vault (the scheduled jobs SQL), and in the Apps Script project's properties; going public doesn't change any of those.

## History fix: exact commands (Task 5, not run)

Task 5 removed every value above from the tracked files (checked with `git grep` for the project ref, both emails, all four Piazza ids, and the production host: no matches). History still has them. Pick one option; both rewrite what GitHub shows, so they wait for you. Run them from a clean checkout of `main` with nothing uncommitted.

First, set the commit email to your GitHub noreply address (GitHub, Settings, Emails, "Keep my email addresses private" shows it):

```
git config user.email "<id>+DylanCarter16@users.noreply.github.com"
```

**Option A, fresh single-commit history (recommended).** Simplest; nothing old can leak.

```
git checkout --orphan public-main
git add -A                      # src/config/term.local.ts and .env.local stay out (gitignored)
git status --short              # check nothing private is staged
git commit -m "Runway: personal course tracker for Waterloo"
git grep -nF "<your project ref>"; git grep -nF "<your production host>"   # both print nothing
git push --force origin public-main:main
git push origin --delete phase-9 worktree-google-signin worktree-phase-10-plan
```

Keep the old history as a private archive first if you want it: create an empty private repo `runway-archive` on GitHub, then `git push --mirror https://github.com/DylanCarter16/runway-archive.git` before the force push.

**Option B, `git filter-repo`** (keeps the commit-by-commit autopilot story). Needs `pip install git-filter-repo`. Make two files outside the repo, never committed:

- `../replacements.txt`, one line per value: `<project ref>==><SUPABASE_PROJECT_REF>`, `<production host>==><APP_HOST>`, and each Piazza id `==>` a placeholder.
- `../mailmap.txt`: `DylanCarter16 <id+DylanCarter16@users.noreply.github.com> <your personal email>`

```
git clone --mirror https://github.com/DylanCarter16/runway.git runway-rewrite
cd runway-rewrite
git filter-repo --replace-text ../replacements.txt --mailmap ../mailmap.txt --path src/config/term-f26.ts --invert-paths
git remote add origin https://github.com/DylanCarter16/runway.git   # filter-repo removes it
git push --force --mirror origin
```

Then delete and re-clone your local copy (old objects stay in it otherwise), and run `git gc --prune=now` on any other clone. Either way, change the repo's visibility yourself afterwards (Settings, General, Danger Zone).
