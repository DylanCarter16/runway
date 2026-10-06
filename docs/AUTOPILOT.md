# Autopilot

You are running unattended. Dylan is not watching, will not answer questions, and may not read anything until the run ends. Read this file at the start of every session, before `docs/PHASES.md`.

## Mission

Finish Phases 1 through 8 in `docs/PHASES.md`, committed and pushed to `main`, with the production site working. When every phase is done, write `docs/HANDOFF.md` and create the file `.autopilot/DONE`, which stops the loop.

## The empty chair

Nobody can answer a question or approve a prompt. Anything that would normally be a question has one of two answers here:

1. A rule below already decides it. Follow the rule and log the choice in `docs/DECISIONS.md`.
2. Nothing decides it. Park it: append an entry to `docs/BLOCKED.md`, mark the item in `docs/PROGRESS.md`, and move to the next task that isn't blocked.

Never wait, never idle, never ask. A parked item costs an hour of Dylan's time later. A stalled run costs the whole night.

`docs/BLOCKED.md` entries use this shape:

```
## <phase>: <one-line title>
- Needed: <the exact thing a human must do, with the URL>
- Why: <what it unblocks>
- Done so far: <code that is written and tested behind it>
- Time: <estimate for Dylan>
```

## Order of work

Do the phases in order, with one exception: when a phase is blocked on a credential or a human click, skip it and take the next one, then come back if the block clears. Phases 1, 2, 3, 5, 6, and 8 need no account clicks. Phase 4 needs Google OAuth credentials, and Phase 7 needs the Apps Script bridge.

Within a phase, work in small steps. Commit after each step with `phase N: <what changed>`. Push at the end of each step.

## Quality gates

- Never push a red tree. `npm run lint && npm run typecheck && npm run test && npm run build` passes before every push.
- A failing check gets three fix attempts. After the third, `git revert` the last commit, write the failure in `docs/BLOCKED.md`, and move on.
- Never delete or skip a test to make a suite pass. Never weaken an assertion to match broken behaviour.
- Deploy with `npx vercel deploy --prod` at the end of each phase that changes runtime behaviour, then check the production URL returns 200 with `curl -sI`.

## Pre-authorized decisions

- **Stack**: as named in `CLAUDE.md`. A library it doesn't name gets the most widely used maintained option; log it in `docs/DECISIONS.md`.
- **Schema changes**: write a migration under `supabase/migrations/`, apply it with `npx supabase db push --linked` using the password in `.env.local`, regenerate `src/lib/db/types.ts`, and run `tests/db/run.sh` when a local Postgres is available.
- **Seed data**: `src/config/term.local.ts` (gitignored, stored in `settings.term_seed`) is correct. Do not rewrite its dates from any other source.
- **AI switch**: build Phases 5 and 6 in full for every course. Leave `ai_allowed` as seeded (STAT 230 on, CS 245, CS 246, and CS 251 off). The code respects the switch; Dylan flips it in Settings.
- **LEARN feed**: if `LEARN_ICS_URL` exists in `.env.local`, seed it as the feed and mark the Phase 2 LEARN work done. If not, build the parser against `tests/fixtures/` and park the live sync.
- **Missing secret**: park that source, build its code and tests against fixtures, and carry on. Never invent a key, never stub a credential into the repo.
- **Ambiguous product decision**: pick the option that adds less code, log it, and note the alternative in `docs/HANDOFF.md`.
- **Scope**: nothing outside `docs/PHASES.md`. Ideas go under "Later" in `docs/PROGRESS.md`.

## Spending

- Claude API calls the app makes during tests use recorded fixtures. Never call the live API from a test.
- Phase 3 and later use `ANTHROPIC_API_KEY` at runtime only. Keep `AI_MONTHLY_BUDGET_USD` enforcement in the code path.
- Your own run has a budget cap in the runner. When a cycle ends, leave the tree clean so the next cycle can pick up.

## Never

- Never run `git push --force`, `git reset --hard` on pushed commits, or `rm -rf` outside the repo.
- Never delete or rename the GitHub repo, the Supabase project, or the Vercel project.
- Never print, log, or commit a secret. `.env.local` is read-only input.
- Never change Vercel deployment protection, Supabase auth providers, or any dashboard setting through an API.
- Never open a browser flow. Anything needing a Google, UW, or Piazza login is a `docs/BLOCKED.md` entry.

## Session shape

Start: read `CLAUDE.md`, `docs/PROGRESS.md`, this file, then the current phase in `docs/PHASES.md`.

Finish: update `docs/PROGRESS.md` with what landed, what is parked, and the next step. Commit and push. Keep `docs/PROGRESS.md` accurate enough that a fresh session with no memory of this one can continue from it, because that is exactly what happens next.

## Definition of done

All of these, then write `docs/HANDOFF.md` and create `.autopilot/DONE`:

- Phases 1 through 8 marked complete in `docs/PROGRESS.md`, or parked with a `docs/BLOCKED.md` entry naming the human step.
- `main` is pushed, CI is green, production deploy returns 200.
- The app loads the Fall 2026 seed, shows the calendar and course tabs, and search finds a seeded item.
- `docs/HANDOFF.md` lists: what works, what is parked and why, every manual step left with its URL and time estimate, the monthly cost to run, and the three things most likely to break first.
