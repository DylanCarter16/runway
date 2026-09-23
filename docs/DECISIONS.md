# Decisions log (autopilot)

Choices made during unattended runs under docs/AUTOPILOT.md. Older decisions live in the Decisions table in docs/PROGRESS.md.

| Date | Phase | Decision | Why | Alternative |
|---|---|---|---|---|
| 2026-09-23 | 1 | Added migration `20260923000000_init_drift.sql` and applied it | The hosted project had an earlier draft of the init schema: no `courses.ai_allowed`, no `items.flags`, `cs251_assignments` missing from two check constraints, and the change-log trigger not tracking `flags`. The migration is a no-op on a database built from the current init file | Re-creating the project |
| 2026-09-23 | 1 | Pinned `@fullcalendar/react` to 6.1.21 | 7.1.0 was installed, which bundles its own FullCalendar 7 core and does not match the v6 plugins in the stack | Upgrading every FullCalendar package to 7 |
| 2026-09-23 | 1 | The term import inserts with "skip on conflict" for every table | Running it twice changes nothing, and it never overwrites Dylan's edits. Seed changes to existing rows would need a new mechanism | Upsert-and-overwrite |
| 2026-09-23 | 1 | Every dated item stores `due_at`; exams and timed items with a duration also get `starts_at` and `ends_at`; multi-day items end at local midnight after their last day | One sort key for lists and the coverage meter (undated means `due_at` is null) | Exams with `starts_at` only |
| 2026-09-23 | 1 | Date-only items count as due at the end of their local day for countdowns and overdue checks | An item "due Sep 30, time not set" should not show as overdue at 12:01 am on Sep 30 | Treat midnight as the deadline |
| 2026-09-23 | 1 | Calendar shows times in the browser's time zone | Correct Toronto rendering inside FullCalendar needs a time-zone plugin (luxon) that the stack doesn't name. All-day items are passed as Toronto dates, so they are always right | Add `@fullcalendar/luxon3` |
| 2026-09-23 | 1 | Calendar prep blocks are computed in the browser from the runway rules (one all-day "Prep:" event at runway start), not stored | Phase 4 builds the real prep and study blocks for Google Calendar | Store them now |
| 2026-09-23 | 1 | "Changed recently" on Today hides changes Dylan made himself (source `manual`) | The section is for things that changed under him | Show all changes |
| 2026-09-23 | 1 | Overdue on Today lists only assignment, quiz, project, reading, and other kinds | Tutorials, exams, and admin dates can't be "submitted", so they would sit there forever | All kinds |
| 2026-09-23 | 1 | The acceptance line "CS 245 midterm Oct 29 with a confirm date badge from its flag" can't be met as written: the seed has no flag on that item because the conflict was settled on 2026-09-17 (Quest lists Oct 29 only). The badge renders for `outline_date_conflict` whenever a flag exists | AUTOPILOT.md says the seed data is correct; not editing it | Re-adding the flag |
| 2026-09-23 | 1 | `npm run typecheck` runs `next typegen` first | `PageProps` and `LayoutProps` come from generated route types, which don't exist on a fresh CI checkout | Commit `next-env.d.ts` and the generated types |
| 2026-09-23 | 1 | Empty values in `.env.local` count as unset in `src/env.ts` | `UW_OPENDATA_API_KEY=` failed validation and broke `next build` | Delete the empty lines from `.env.local` (it is read-only input for autopilot) |
| 2026-09-23 | 1 | Shared constants live in `src/lib/ui.ts` and `src/lib/items/labels.ts`, never in a `'use client'` file | A value exported from a client module reaches server components as a client reference, which crashed Today (`ROW_FIELDS.split is not a function`) | none |
| 2026-09-23 | 1 | Settings sections other than Term and Sync are read-only summaries for now | Their controls belong to Phases 2 to 4 and 8 | Build empty forms |
| 2026-09-23 | 1 | Checked the build against the hosted database with a throwaway user created and deleted through the admin API (`@example.invalid` address), and a UI smoke test with a real session cookie. Scripts are in the gitignored `.scratch/` folder | Dylan's OTP sign-in can't be automated | Skip end-to-end checks |
