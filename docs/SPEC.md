# Runway product spec

## 1. Purpose

Dylan takes four Fall 2026 courses (STAT 230, CS 245, CS 246, CS 251). Their dates and info live in LEARN, two course websites, four course outlines, four Piazza classes, Crowdmark, Odyssey, and Quest. Runway gathers all of it into one place, keeps every raw input, turns dates into calendar reminders with prep time, and lets Dylan store lecture notes and ask questions about them.

Design principles:

1. **Findable in two taps.** Every page is reachable from the nav. Every item, note, link, and document is reachable from search.
2. **Organized by course.** Each course has its own page with tabs. The calendar shows everything at once.
3. **Nothing lost.** Raw pastes, emails, and page snapshots are stored verbatim. Dylan's notes are never overwritten.
4. **Humans approve guesses.** Structured sources write straight to the calendar. Anything Claude extracts from free text waits in the review queue.
5. **Show the source.** Every item says where it came from, links back, and shows when that source last synced.
6. **Course rules first.** CS 245, CS 246, and CS 251 ban generative AI, including running course materials through it. Runway only sends a course's content to Claude when that course's AI switch is on (STAT 230 this term).

## 2. Glossary

- **Item**: a dated (or not yet dated) thing: assignment, quiz, midterm, final, project, tutorial, lab, reading, admin date, or break.
- **Runway**: the prep window before an item. An assignment's runway starts 7 days before it's due by default.
- **Document**: any stored raw input (outline paste, Piazza email, page snapshot, assignment PDF text, Quest schedule, Odyssey paste, grades paste).
- **Note**: a lecture note. Holds Dylan's original, Claude's cleaned copy, and Dylan's edits to the cleaned copy.
- **Proposal**: a change Claude extracted from free text, waiting for approval.
- **Paste reminder**: a reminder to copy something Runway can't fetch (see SOURCES.md, catalog).
- **Coverage**: how many of a course's assessments (from the outline) have a confirmed date.
- **AI switch**: `courses.ai_allowed`. Off means nothing from that course goes to Claude.

## 3. Navigation and routes

Desktop: left rail. Mobile: bottom bar plus a scrolling row of course chips under the header. A search field sits at the top of every page (Ctrl/Cmd+K opens the palette).

| Route | Page | Nav |
|---|---|---|
| `/` | Today | rail + bottom bar |
| `/calendar` | Calendar | rail + bottom bar |
| `/inbox` | Paste box, review queue, paste reminders | rail + bottom bar (center "Paste" button) |
| `/courses` | Course list | rail (courses listed by color) + bottom bar |
| `/courses/[slug]/[tab]` | Course page, tabs below | course chips |
| `/notes`, `/notes/new`, `/notes/[id]` | Notes | rail |
| `/ask`, `/ask/[threadId]` | Ask | rail + bottom bar |
| `/library`, `/library/[id]` | All stored documents | rail |
| `/items/[id]` | Item detail (also opens as a drawer from any list) | none |
| `/search?q=` | Full search results | palette "See all" |
| `/settings/[section]` | Settings | rail |
| `/login` | Sign in | none |

Course tabs (`[tab]`): `overview`, `deadlines`, `notes`, `ask`, `resources`, `updates`, `grades`, `library`. `/courses/[slug]` redirects to `overview`. Tabs scroll sideways on mobile and keep their state in the URL so every view has a shareable link.

## 4. Pages

### 4.1 Today (`/`)
- Header: full date, term week ("Week 2"), and a countdown to the next exam.
- "Needs you" strip: pending proposals, paste reminders due, sources failing. Each count links to where it's fixed. Hidden when everything is zero.
- Runway list: active items due in the next 14 days, grouped by day. Each row shows the course mark, title, kind, due time (or "time not set"), a countdown, the runway bar (DESIGN.md), and a progress control (todo, started, submitted).
- Overdue: unsubmitted items past due in the last 7 days, with the course's late policy in one line (for example "CS 251 doesn't accept late work").
- Changed recently: item changes from the last 72 hours ("CS 251 A2 moved from Oct 23 to Oct 26, from the course schedule page").
- Quick actions: Paste, Add item, Ask.

### 4.2 Calendar (`/calendar`)
- FullCalendar with month, week, and list views. Default: week on desktop, list on mobile. Remember the last view.
- Event types and looks: items (course color), prep blocks and study blocks (hatched, lighter), exams (heavier, with room and seat when known), paste and check reminders (small, neutral), breaks and exam periods (background shading).
- Filters: course chips (multi-select), kind, and toggles for prep blocks and reminders. Filters live in the URL.
- Clicking an event opens the item drawer. Clicking an empty slot opens quick add with that date.
- "Jump to" date picker and a Today button. Keyboard: arrows move, `t` jumps to today.

### 4.3 Course page (`/courses/[slug]/[tab]`)
Header: course code and title, next deadline with countdown, and a row of big link buttons for the pinned links (site, outline, Piazza, LEARN, submission tool, notes). Below it, the tabs.

- **Overview**: next 3 items, next exam with time, room, and seat, coverage meter ("7 of 9 assessments dated", tapping it lists the undated ones), late policy, remark policy, AI policy, submission checklist, office hours, staff and contacts, meeting times from Quest, and a free-form notes field.
- **Deadlines**: every item for the course in a table: title, kind, due, weight, progress, grade, source. Filters for kind and progress. Undated assessments appear at the bottom with an "Add date" action.
- **Notes**: notes by lecture date, newest first, with topics. "Paste notes" opens `/notes/new` with this course selected.
- **Ask**: Ask scoped to this course, with past threads. For AI-off courses, the tab shows the outline's AI policy instead of an input.
- **Resources**: all links grouped by category, each with its "where to find" text. Add, edit, pin, reorder.
- **Updates**: one feed of everything that changed or arrived: item changes, page diffs with summaries, Piazza posts, announcement pastes. Each entry links to the stored document.
- **Grades**: marks by assessment and a running weighted average from the grading scheme (Phase 8).
- **Library**: this course's documents, filterable by kind.

### 4.4 Inbox (`/inbox`)
- **Paste box**: one large textarea with a "Paste from clipboard" button on mobile. A course picker (required; "No course" covers term-wide pastes such as the Quest schedule) and a kind picker ("Detect" by default). Kinds: lecture notes, course outline, announcement, Quest class schedule, Odyssey exam row, grades, assignment header, Piazza resources, Crowdmark assessment, other.
  - Detection and extraction run only when the chosen course has AI on. For AI-off courses, the paste is stored, shows in the course's Library and Updates, and Runway opens quick add so Dylan can enter any dates himself.
  - Quest schedules and Odyssey rows are tables, so rule-based parsers handle them without AI. Claude is a fallback only for rows about AI-on courses.
  - Lecture notes go to the Notes flow (4.5). Everything else becomes a document, then an extraction job.
  - Pasting the same text twice shows "Already saved" with a link, and creates nothing.
  - **Files** (Phase 9): drop, pick, or paste PDFs, images, and screenshots into the box. Originals go to the private `library` bucket under `<user_id>/` unchanged (name, size, and type kept; 50 MB cap on the free plan). Text PDFs are read with unpdf; scanned or handwritten pages and photos go to Claude vision 3 pages per call, for AI-on courses only. AI-off courses store the file and each page says why it wasn't read. Nothing is truncated: a page too large to send is stored, skipped, and named. The same file twice shows "Already stored"; pages stored before for the course (a re-exported notebook) are skipped. Uploaded text is chunked for Ask and found by search. With kind "Lecture notes", a file becomes a note (4.5).
- **Review queue**: proposal cards, newest first, sorted by confidence within a source. Each card shows what will happen ("Create CS 251 A3, due Nov 9, time not set" or a before/after for updates), the evidence quote, the source link, and actions: Approve, Edit then approve, Dismiss. Bulk approve is allowed for one source document at a time, behind a confirm dialog.
  - Duplicate check: a create proposal that matches an existing item (same course and kind, similar title, date within 3 days) is shown as an update instead.
  - Course info proposals (policies, office hours, staff, grading scheme, meeting times) show the field and new value. Approving writes it to the course.
- **Paste reminders**: due and overdue reminders from the catalog. Each shows what to copy, where to find it, a link, a "Paste now" button (opens the box with kind and course preset), Snooze (1 day), and Done.

### 4.5 Notes
- **Courses with AI off** (CS 245, CS 246, CS 251 this term): the note is stored and searchable exactly as written. The Cleaned and Compare views, re-run, topics, summary, and open questions are hidden, and the note page quotes the course's AI policy to say why.
- **New note** (`/notes/new`): course (required), lecture date (defaults to today, or the most recent lecture day from the Quest meetings), optional title, and the paste area. Save stores the original immediately and shows the note page with a "Cleaning up..." state.
- **Note page** (`/notes/[id]`):
  - Header: course mark, lecture date, title, topic chips, and a two-line summary.
  - View switch: **Mine** (original, exactly as pasted), **Cleaned** (Claude's copy, or Dylan's edited version when one exists), **Compare** (side by side on desktop, inline word diff on mobile).
  - Edit: markdown editor for the cleaned copy with live preview. Saving writes `edited_md`; the Claude copy stays in `cleaned_md`. "Reset to Claude's copy" clears the edit.
  - Re-run cleanup with an optional instruction ("put the truth tables in markdown tables"). The new result replaces `cleaned_md` after a confirm when an edited copy exists.
  - Open questions: passages Claude marked `[?]` plus questions found in the notes. Each has "Ask about this".
  - "Ask about this note" opens Ask scoped to the note.
  - Dates mentioned in the notes ("midterm moved to Nov 19") appear as proposals in the review queue, linked from the note.
  - Rendering: KaTeX for math, fenced code with syntax highlighting, tables. Reading font per DESIGN.md.
- **Notes list** (`/notes`): all notes, filter by course, search box, sorted by lecture date.
- **Running notes** (Phase 9): Dylan keeps one document per course and pastes all of it after each lecture. The full paste is stored as a `note_source` document; the note holds only what is new since the course's last paste (appended paragraphs, paragraphs added to earlier sections, and edited paragraphs marked "Revised since your last paste"). Moved or re-pasted text is skipped. The note page says what was decided ("2 new paragraphs, 4 lines skipped") with "Undo: keep the whole paste as one note". A paste with nothing new makes no note and offers the same undo. The first paste for a course becomes the note whole.
- **Notes from files**: the note form takes a PDF or photos. Pages already stored for the course are skipped, so a re-exported GoodNotes notebook adds only its new pages; for AI-on courses the transcription is the cleaned copy and the original names the file and pages; the same undo keeps every page.
- Cleanup never adds facts. It fixes spelling, grammar, and formatting; keeps every fact, formula, and code line; and marks unclear passages with `[?]`. The style prompt is editable in Settings > AI.

### 4.6 Ask (`/ask`)
- Scope picker: Everything, a course, a note, an item. Only AI-on courses and their notes and items appear, and Everything means every AI-on course. The scope shows as a chip above the input and can change mid-thread.
- Answers stream in with inline citation markers. A sources panel lists the passages used; each opens the note or document at that passage.
- If the sources don't cover the question, the answer says so first, then gives a general explanation under the heading "General knowledge (not from your notes)".
- "Deep" toggle switches to `MODEL_ASK_DEEP` for that message.
- Quick prompts: "Explain this simply", "Quiz me on this" (5 questions, answers at the end), "What's on the midterm?" (uses the outline and announcements), "Summarize this week".
- Assignment scopes show a banner with the course's AI policy from the outline, plus a link to the outline. If the policy is unknown, the banner says so and suggests checking the outline. By default, Ask explains concepts and points to relevant notes for assignment scopes. It doesn't write answers to graded questions.
- Threads are saved and listed on `/ask` and in each course's Ask tab.
- Budget: when month-to-date AI spend passes `AI_MONTHLY_BUDGET_USD`, Ask uses `MODEL_EXTRACT` and shows a one-line notice.

### 4.7 Search
- The palette (Ctrl/Cmd+K, or the search icon on mobile) searches items, notes, documents, links, and page names. Results are grouped by type with the course mark, date, and a snippet. Enter opens; arrows move; Esc closes. "See all results" opens `/search`.
- Alias expansion before querying: a course number or code ("251", "cs251", "CS 251") becomes a course filter; "a3" becomes "A3"; "mt" and "midterm" match kind `midterm`; "final" matches kind `final`.
- `/search` adds filters (type, course, date range) and shows up to 100 results.
- The palette also lists recent items and recent searches before typing.
- Backed by the `search_all` database function (typo tolerant through trigram word similarity).

### 4.8 Library (`/library`)
- Every stored document with filters for kind, course, and date, plus full-text search.
- Detail page: title, kind, course, captured time, source link, raw text, the original file when stored, proposals and items it produced, and for page snapshots a diff against the previous snapshot.
- Files: name, type, size, pages, "Open the original" (a signed link), what was read and how (PDF text or Claude), each page's text, skipped pages with the reason, "Try the failed pages again", and for PDFs with unread pages "Extract pages" (a page range).
- **Textbooks**: added from a course's Resources tab with "It's a textbook". Stored and listed under Files, Textbooks; nothing is read until Extract pages asks for a chapter.

### 4.9 Item detail (drawer and `/items/[id]`)
Title, course, kind, dates (with "time not set" when unknown), location and seat, weight, progress, source with link and last sync time, change history, related notes and documents, the course's late policy and submission checklist, and actions: mark started or submitted, edit, change reminders, dismiss, open source, ask about this.

### 4.10 Settings (`/settings/[section]`)
- **Term**: "Load Fall 2026 setup" (idempotent import of `src/config/term-f26.ts`), term dates, current term.
- **Courses**: colors, links, policies, checklist, external ids, Piazza class mapping (each of the four class ids gets a course dropdown). Each course shows its AI switch beside the outline's AI policy. Turning a switch on asks Dylan to type the course code and confirm the instructor allows AI for this use.
- **Integrations**: Google Calendar (connect, status, reconnect, calendar name), LEARN feed URL (write-only field, stored encrypted), UW Open Data key status, Apps Script bridge status (last ping and last email received), Microsoft (optional, Phase 7).
- **Reminders**: rule editor per kind (runway days and up to 5 reminder offsets), study block hour, digest hour, weekly sweep time.
- **AI**: model names in use, note cleanup style prompt, Ask answer style prompt, Ask context budget, month-to-date spend with a per-purpose breakdown.
- **Sync**: one row per source with last run, result, item counts, error text, and a "Run now" button.
- **Data**: export everything as JSON plus stored files as a zip; delete a term.

## 5. Reminder rules

Defaults live in `src/lib/reminders/rules.ts` and can be overridden in Settings or per item. Google Calendar allows at most 5 reminder overrides per event and at most 4 weeks (40320 minutes) before the event.

| Kind | Runway (prep block) | Reminders before due or start |
|---|---|---|
| assignment | 7 days (CS 246: 10 days) | 7d, 3d, 1d, 3h |
| project | 21 days | 14d, 7d, 3d, 1d |
| quiz | 2 days | 2d, 2h |
| midterm | 3 study blocks in the 7 days before | 10d, 3d, 1d, 2h |
| final | study blocks every other day from 14 days before | 14d, 7d, 3d, 1d, 2h |
| tutorial, lab | none | 1d, 1h |
| admin (drop dates, fee deadlines) | none | 7d, 1d |
| break | none (background event) | none |

- Prep blocks: one all-day "Prep: CS 251 A3" event on the day the runway starts, plus a timed 90-minute "Start CS 251 A3" block at the study block hour.
- Study blocks for exams: 90 minutes at the study block hour on the chosen days, titled "Study: CS 251 midterm".
- Items with `time_known = false` are all-day events titled with "(time TBD)"; reminders count back from 9:00 on the due date.
- Exams also get a check reminder 3 days before: "Check Odyssey for your CS 251 midterm seat."
- Dismissed items delete their calendar events. Submitted items keep the event, drop the remaining reminders, and get a check mark in the title.

## 6. Morning digest

Sent by the Apps Script bridge at the digest hour. `GET /api/digest` returns `{ send, subject, text, html }`. Contents: due today and tomorrow, next 7 days, exams in the next 14 days with seat status, pending proposals, paste reminders due, sources failing, and items that changed in the last 24 hours. `send` is false when every section is empty.

## 7. Non-functional requirements

- **Access**: single user. Sign-in is Google through Supabase Auth: `/login` has one "Continue with Google" button (`signInWithOAuth`, PKCE), and `/auth/callback` exchanges the code for a session. Only the Google account whose email is `ALLOWED_EMAIL` stays signed in; any other account is signed out at the callback and sees "This app is private." `proxy.ts` also treats a session for any other email as signed out. No email is sent, so Supabase's sender limits don't apply. Sessions last until sign-out.
- **Speed**: Today renders in under 1 second on a phone over LTE with a term's worth of data. Palette results appear within 300 ms of typing.
- **Reliability**: every sync writes a `sync_runs` row. Three failed runs in a row for a source puts a banner on Today and a line in the digest. Jobs retry up to 3 times with backoff.
- **Cost**: every Claude call is logged with tokens and cost. The price table in `src/lib/ai/pricing.ts` is filled from Anthropic's pricing page. Spend shows in Settings > AI.
- **Privacy**: no public pages besides `/login`. Storage bucket is private. OAuth tokens and the LEARN feed URL are encrypted at rest (AES-256-GCM, key in env).
- **Accessibility**: full keyboard use, visible focus, 44px touch targets, urgency never shown by color alone, reduced motion respected.
- **Time**: all display in America/Toronto. Tests cover the Nov 1, 2026 DST change.
- **Backups**: Settings > Data export works at any time.
- **Course policy**: tests prove content from AI-off courses never reaches `callClaude()`.

## 8. Out of scope

- Other users or sharing.
- Scraping Piazza or using unofficial Piazza clients.
- Automating any UW login (WatIAM, Duo, LEARN, Quest, Odyssey) or storing the UW password.
- Server-side fetching of outline.uwaterloo.ca.
- Writing anything back to LEARN, Crowdmark, Piazza, or Marmoset.
- Sending material from AI-off courses to any AI model.
- A native app. (A PWA install is in Phase 8.)
