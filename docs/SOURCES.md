# Data sources

Facts below were checked on 2026-09-15. Course pages change during the term; the page watcher exists for that reason.

## Summary

| Source | Courses | How Runway gets it | Cadence | Writes |
|---|---|---|---|---|
| LEARN calendar feed | STAT 230, CS 245 | iCal URL (Dylan copies it once) | hourly | items directly |
| CS 251 schedule page | CS 251 | fetch + cheerio parser | every 3 hours | items directly |
| CS 251 exam info page | CS 251 | fetch + cheerio parser | daily | items directly |
| CS 251 assignments page | CS 251 | fetch + cheerio parser | every 3 hours | due times on items |
| Course page watcher | CS 246, CS 251 | fetch, hash, diff, Claude summary | daily | documents, proposals |
| UW Open Data API | all | REST with API key | daily | items directly |
| Piazza | all four | email, via the Apps Script bridge | every 15 minutes | documents, proposals |
| Course outlines | all | read once; seeded in the term config | once per term | seed items, course fields |
| Quest class schedule | all | paste | once per term | course meetings (proposal) |
| Odyssey | all exams | paste (Phase 8: userscript) | 3 days before each exam | proposals |
| CS 246 assignment headers | CS 246 | paste | per assignment | proposals |
| Crowdmark | CS 251, maybe others | paste (Phase 7: optional Microsoft Graph) | per assessment | proposals |
| Grades | all | paste | when marks are released | proposals |
| Lecture notes | all | paste | after each lecture | notes |

"Items directly" means the source is structured enough to skip review. Everything else goes through the review queue.

## Parser output shape

Page parsers are pure functions and never touch the database. A separate sync step writes the results with the merge rules below. The schedule and assignments parsers return `ParsedEvent[]`; the exam info parser returns `ParsedExam[]`.

```ts
type ParsedEvent = {
  sourceRef: string;              // stable id, e.g. "cs251:A1"
  kind: 'assignment' | 'quiz' | 'midterm' | 'final' | 'project' | 'break' | 'admin' | 'other';
  title: string;
  date: string | null;            // YYYY-MM-DD in America/Toronto; null when TBA
  endDate: string | null;         // ranges such as reading week
  time: string | null;            // HH:MM local; null when the page gives no time
  timeKnown: boolean;
  sourceUrl: string | null;       // absolute
  flags: string[];                // e.g. date_tba, date_changed, link_points_to_other_term
};

type ParsedExam = {
  sourceRef: string;              // "cs251:midterm", "cs251:final"
  kind: 'midterm' | 'final';
  title: string;
  startsAt: string | null;        // ISO 8601 with the Toronto offset for that date
  endsAt: string | null;
  durationMinutes: number | null;
  location: string | null;
  flags: string[];                // e.g. date_tba, location_tba
};
```

HTML comments on course pages hold old policies and last term's dates. Every parser strips comments before reading text.

## 1. LEARN calendar feed (STAT 230, CS 245)

- **Setup (Dylan, once)**: LEARN, Calendar, Settings, turn on "Enable Calendar Feeds". Then Subscribe, choose "All Calendars and Tasks", copy the URL, and paste it into Settings > Integrations. Per-course feeds also exist if the combined feed gets noisy.
- **Storage**: the URL contains a private token. Store it encrypted in `integration_tokens` (provider `learn_ics`). Never log it.
- **Sync**: fetch hourly, parse with node-ical. Only events between term start minus 7 days and term end plus 7 days count.
- **Mapping**:
  - `source = 'learn_ics'`, `source_ref = UID` (append `RECURRENCE-ID` when present).
  - Course: match the event's summary, location, or description against each course's `learnNames`. Unmatched events go to the review queue as proposals with course unset.
  - Kind: keyword match on the title (quiz, assignment, midterm, exam, due), default `assignment`.
  - Time: use DTEND when present, else DTSTART. Date-only values set `all_day = true`, `time_known = false`.
  - If an upcoming UID disappears from the feed, set `source_missing_at` and show "Removed from LEARN" in Updates. Don't delete.
- **Limits**: the feed only has what instructors put on the LEARN calendar. The outline paste fills the gaps, and the coverage meter shows what's still undated. Brightspace's REST API needs an admin-registered app, so it isn't an option.

## 2. CS 251 schedule page

- **URL**: https://student.cs.uwaterloo.ca/~cs251/F26/schedule.shtml
- **Fixture**: `tests/fixtures/pages/cs251-schedule-f26.html` with the expected output in `cs251-schedule-f26.expected.json`. The parser test must match it exactly.
- **Rules**:
  - Rows are `table.schedule tr`. Column 1 is the date, column 2 the topic.
  - An event row's topic cell contains a `<span>` with `color:#a00` (deadline or exam) or `color:#060` (break). Other rows are lectures, even when their text mentions an exam ("Review for midterm", "Review for final exam").
  - `A<n> due` becomes kind `assignment`, title `A<n>`, `source_ref = cs251:A<n>`, source URL from the link, resolved against the page URL.
  - Text containing "midterm" becomes `cs251:midterm`. Text containing "final exam" becomes `cs251:final`.
  - `#060` rows become kind `break` with `source_ref = cs251:break:<start date>`.
  - Dates: "Sep" and "Sept" both appear. Ranges look like "Oct 13-15". "TBA" means null plus the `date_tba` flag. The year is the term year.
  - The final exam link points at the F25 page. Keep the URL and add `link_points_to_other_term` when a link's path has a term folder other than `F26`.
- **Traps in the real HTML**: missing and stray `<td>` tags, an unclosed `<A>`, HTML comments inside rows, rows with class `DONE` scattered around (ignore the class), and two rows dated Nov 12 (the midterm and a lecture).
- **Assignment PDFs** (Phase 2, optional step): fetch each linked PDF when it appears or changes, extract text with unpdf, store it as an `assignment_pdf` document, and run the assignment header prompt to find a due time. A found time becomes an update proposal.
- **Course facts** (seeded in the term config, rechecked 2026-09-17): assignments go through Crowdmark; late assignments are not accepted unless the course ISC grants an accommodation; a signed academic integrity cover page is required as page 1; resubmitting erases earlier uploads; pages submitted out of order can be remarked with a 15% penalty; solutions go on the password-protected notes page a couple of days after the due date; remark requests within one week of return. There is no LEARN page; announcements are on Piazza. The assignments page also carries an old "48 hours late at 10% per day" rule inside an HTML comment. That rule is not in force.

## 3. CS 251 exam info page

- **URL**: https://student.cs.uwaterloo.ca/~cs251/F26/examinfo.shtml
- **Fixture**: `tests/fixtures/pages/cs251-examinfo-f26.html` with `cs251-examinfo-f26.expected.json`.
- **Rules**: read the `h2` sections "Midterm" and "Final Exam". Parse "Thursday, November 12, 4:30-6:20pm" into start and end times in America/Toronto (UTC-05:00 that day, after the DST change). "Location: TBA" means location null plus `location_tba`. A section whose only text is "TBA" means no date yet.
- **Trap**: the page has a 2022 makeup exam inside an HTML comment. Strip comments before reading text.
- The exam info sync doesn't create rows of its own. It looks up the item with `source = 'cs251_schedule'` and the same `source_ref` (`cs251:midterm`, `cs251:final`), creates it under that source if the schedule sync hasn't run yet, and updates `starts_at`, `ends_at`, `time_known`, and `location` with `last_change_source = 'cs251_examinfo'`.

## 3b. CS 251 assignments page

- **URL**: https://student.cs.uwaterloo.ca/~cs251/F26/assignments.shtml
- **Fixture**: `tests/fixtures/pages/cs251-assignments-f26.html` with `cs251-assignments-f26.expected.json` (captured 2026-09-17, when only A1 was posted).
- **Purpose**: it's the only CS 251 page with due times. A1 is due Wednesday, Sept 30 at 10:00 pm.
- **Rules**: strip comments first. Read rows of the first table whose first cell is "Assignment N" and whose second cell isn't empty; rows for the cover page and readings have empty date cells. In the HTML, a due cell reads `Wednesday September 30 &mdash; 10:00 pm`; older rows also use `10:00pm` with no space. A `<s>` element holds a replaced date: drop its text and add the flag `date_changed`. Output `source_ref = cs251:A<n>`, the date, the time, and `timeKnown = true`.
- **Traps**: commented-out rows for A2 to A4 carry last term's dates, and the late policy section hides an old rule inside a comment.
- **Sync**: like the exam info sync, it updates the schedule's `cs251:A<n>` item (creating it under `cs251_schedule` when missing), sets `due_at` with the time and `time_known = true`, and uses `last_change_source = 'cs251_assignments'`.

## Merge rules for all syncs

- **Precision never drops.** A sync that only knows a date doesn't overwrite an item whose `time_known` is true and whose local date matches. If the date differs, it updates the date and sets `time_known = false` until a more precise source restores the time.
- **Syncs don't own `state` or `progress`.** Upserts update dates, title, location, and URLs only. Dismissals and progress belong to Dylan and to the finals merge (section 7).
- **Dylan's edits win.** A manual edit adds the edited field names to `items.locked_fields`. A sync that disagrees with a locked field creates an update proposal instead of overwriting it. Approving that proposal applies the value and unlocks the field.

## 4. Course page watcher (CS 246 and CS 251)

- Pages come from `watched_pages` (seeded from the term config). Pages with a `cs251_*` parser also get snapshots and diffs, then run their parser.
- Conditional GET with ETag and Last-Modified. On change: strip scripts, styles, and comments; normalize whitespace; hash the text; store a `page_snapshot` document only when the hash differs; diff against the previous snapshot; run the page diff prompt for AI-on courses only; show the result in the course's Updates tab. Every watched page this term belongs to an AI-off course, so they show raw diffs, and Dylan adds changed dates with quick add.
- **CS 246 facts** (seeded): the official deadlines are in the course outline; assignments come from the course git repo with the due time printed at the top; no late assignments; submissions go to Marmoset and handmarking results appear in MarkUs; no LEARN in in-person terms; no online notes; project demos happen in the last few lecture days; remark requests go to the ISA within two weeks of return; the course is not recommended during a co-op term.
- Be polite: at most one request per page per cadence window, User-Agent `Runway/1.0 (personal course tracker; contact: <ALLOWED_EMAIL>)`, 10 second timeout, no retries within the same window.

## 5. Course outlines

- CS 246: https://outline.uwaterloo.ca/viewer/view/nvr3n4
- CS 251: https://outline.uwaterloo.ca/viewer/view/nve57s
- STAT 230 and CS 245: linked from each LEARN course home.
- outline.uwaterloo.ca disallows automated access in robots.txt, so the server never fetches it.
- **Fall 2026 is done.** All four outlines were read on 2026-09-17. Their dates, weights, grading schemes, late, remark, and AI policies, staff, and office hours live in `src/config/term.local.ts` (gitignored, stored in `settings.term_seed`) (seed items use `source = 'seed'`), so Runway doesn't extract them.
- AI policies: CS 245, CS 246, and CS 251 ban generative AI and name "running course materials through GenAI" as a Policy 71 violation. STAT 230 allows AI as a study aid outside assessments. The seed sets each course's `ai_allowed` to match.
- Known issue: CS 245's assessment table says "Tuesday, October 28" for the midterm, but Oct 28, 2026 is a Wednesday, and the outline's test section says Thursday, Oct 29. The seed uses Oct 29 with the flag `outline_date_conflict`.
- STAT 230 workshops and quizzes happen in the Friday tutorial, whose time depends on the section. Those seed items have no time and the flag `time_depends_on_section` until the Quest paste supplies Dylan's section.
- New outline versions: for AI-on courses, paste them and the outline prompt proposes changes. For AI-off courses, Dylan updates dates with quick add.

## 6. Piazza (email only)

- **Class ids**: listed in the term config's `piazzaClasses` (kept out of git; see `src/config/term.template.ts`). Dylan maps each to a course in Settings. Piazza email links contain `/class/<id>`, which is how an email finds its course.
- **Setup (Dylan)**: Piazza account settings, add the Gmail address and make it the preferred address. For each class, set notifications to Real Time, and at minimum "instructor posts". Instructors can also force immediate emails for announcements.
- **Bridge**: the Apps Script (`scripts/apps-script/Code.gs`) searches `from:piazza.com newer_than:2d` every 15 minutes and posts batches of up to 10 messages to `POST /api/ingest/email`. It resends overlapping messages on purpose; the server ignores Gmail ids it has already stored (unique index on documents).
- **AI-off courses** (CS 245, CS 246, CS 251 this term): emails are stored and listed in Updates with subject, sender, and link. No extraction runs; Dylan turns dates into items with quick add.
- **Server**: verify the signature, store each new message as a `piazza_email` document (source_ref = Gmail id, title = subject, raw_text = plain body, raw_html = HTML body, meta = from, date, class id, post URL), then enqueue the Piazza prompt. The Updates tab shows the post summary with a link to the post.
- **Rules**: Piazza's terms prohibit scraping without written permission. Don't use unofficial Piazza API clients, and don't fetch piazza.com pages from the server.

## 7. UW Open Data API

- Base URL `https://openapi.data.uwaterloo.ca`, spec at `/swagger/v1/swagger.json`. Key from `POST /v3/Account/Register?email=&project=&uri=`, confirmed with `POST /v3/Account/Confirm?email=&code=` (SETUP step 4). Send it as the `x-api-key` header. Store in `UW_OPENDATA_API_KEY`.
- `GET /v3/Terms/1269`: official `termBeginDate` and `termEndDate`. Use them to correct `terms.starts_on` and `terms.ends_on`.
- `GET /v3/ExamSchedules/{termCode}`: final exams. Fall 2026 is term `1269`. The Fall 2026 schedule is published on **October 2, 2026**. Poll daily from October 1; an empty response before then is normal and not a failure.
  - Row fields: `examDisplayName`, `sections`, `day`, `examWindowStartDate`, `examWindowStartTime`, `examDuration`, `location`, `isOnlineDescription`, `notes`. Match rows to courses by the course code in `examDisplayName`, and to Dylan's sections through `sections` and the Quest meetings.
  - Upsert kind `final`, `source = 'open_data'`, `source_ref = final:<slug>`. Link the course's schedule item (`cs251:final`) by marking the schedule item `dismissed` with `last_change_source = 'open_data'` so only one final shows.
  - Location from the API is general. Seats come from Odyssey.
- `GET /v3/ImportantDates`: term dates, reading week, drop deadlines, exam period. Each entry has `id`, `name`, and `details[]` with `termName`, `startDate`, `endDate`. Keep details for the current term and upsert them as kind `admin` or `break` with `source_ref = date:<id>`.
- `GET /v3/ClassSchedules/1269/{subject}/{catalogNumber}` lists public section times. It can fill `courses.meetings` when Dylan knows his section numbers but hasn't pasted Quest yet.
- Public data only. No login.

## 8. Odyssey (manual)

- https://odyssey.uwaterloo.ca/teaching/schedule shows finals and midterms that use Odyssey. The same data appears in Portal under Academics. Seats are assigned only a few days before each exam.
- It sits behind WatIAM and Duo, so Runway never fetches it.
- Flow: a check reminder before each exam (repeating daily until the item has a seat). Dylan pastes the row, and a rule-based parser (the rows are a table) proposes an update with room and seat. No AI involved.
- Phase 8 (built): a Tampermonkey userscript (Settings, Integrations, "Odyssey userscript") reads the tables while Dylan is signed in and posts the cells to `POST /api/ingest/odyssey` with a personal token. The server stores them as an Odyssey paste and runs the same parser.

## 9. Quest class schedule (paste)

- Quest, Class Schedule, List View, select all, paste. Gives each course's lecture, tutorial, lab, and test sections with days, times, rooms, and date ranges.
- **Fall 2026 is done.** Dylan's sections were read on 2026-09-17 and live in `src/config/term.local.ts` as `meetings`. Paste again only after an enrolment change.
- A rule-based parser reads it (the page is a table). Claude is a fallback only for rows about AI-on courses.
- Stored on `courses.meetings` after approval. Used for lecture-note reminders, default lecture dates on new notes, and matching final exam sections.

## 10. Crowdmark

- Crowdmark emails a unique link for each assessment to the @uwaterloo.ca address. UW's IST advises against forwarding UW mail to Gmail because forwarded mail can be rejected, so Runway doesn't rely on forwarding.
- Default: a paste reminder when Dylan sees a Crowdmark email ("paste the assessment title and due date").
- Phase 7 spike (1 hour max): Microsoft Graph with a personal app registration and delegated `Mail.Read`, filtered to Crowdmark senders. If the UW tenant requires admin consent, stop and record that in PROGRESS.md.

## 11. Paste reminder catalog

Generated by `src/lib/reminders` from the term config, the items table, and the course meetings. `dedupe_key` keeps each reminder unique.

| Key (`dedupe_key`) | What to paste or check | When | Where to find it | Link |
|---|---|---|---|---|
| `quest_schedule:1269` | Class schedule, List View | Term start, and after any enrolment change | Quest, Class Schedule | https://quest.pecs.uwaterloo.ca/ |
| `outline:<slug>` | A new outline version | Only when a course announces one (Fall 2026 outlines are seeded) | CS 246 and CS 251: outline links above. STAT 230, CS 245: LEARN course home | course outline URL |
| `piazza_resources:<slug>` | Piazza Resources tab (course info, staff, office hours) | First week, then when an instructor post says it changed | Piazza class, Resources | `https://piazza.com/class/<nid>/resources` |
| `learn_announcements:<slug>:<week>` | New LEARN announcements | Sundays 18:00 | LEARN course home, Announcements | https://learn.uwaterloo.ca/ |
| `cs246_assignment:<n>` | Compare the due date at the top of each new CS 246 assignment with the calendar | When Piazza announces a new assignment | Course git repo (set up in A0) | none |
| `crowdmark:<slug>:<title>` | Assessment title and due date | When a Crowdmark release email arrives | UW Outlook inbox, Crowdmark | https://app.crowdmark.com/ |
| `seat:<item_id>` | Room and seat for the exam | 3 days before each exam, daily until filled | Odyssey or Portal, Academics | https://odyssey.uwaterloo.ca/teaching/schedule |
| `finals_check:1269` | Confirm finals imported | October 3, 2026, only if the API import found nothing | Final exam schedule page | https://uwaterloo.ca/the-centre/academics/final-examination-schedule |
| `grades:<slug>:<item_id>` | Marks for a returned assessment | When a Piazza post or email says marks are out | LEARN Grades, Crowdmark, Marmoset, MarkUs | per course |
| `notes:<slug>:<date>` | Today's lecture notes, and anything said about dates | 21:00 on each lecture day (one reminder per day listing that day's courses) | Your own notes | `/notes/new` |
| `sweep:<week>` | Weekly check of everything still pending | Sundays 18:00 | Runway Inbox | `/inbox` |

Paste and check reminders also go to Google Calendar as short timed events on the Runway calendar, so they notify on the phone.
