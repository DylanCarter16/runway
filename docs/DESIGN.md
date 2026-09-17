# Design

## Brief

Runway is a study tool for one Waterloo CS student, used mostly on a phone between classes and on a laptop while planning the week. Its job is to make any date, note, or link findable in seconds. The design borrows from the student's world: engineering graph paper, pen ink, a chalkboard, and the pink tie of Waterloo's Faculty of Mathematics.

The one memorable element is the **runway bar**, a thin track under each deadline showing how much of its prep window has passed. Everything around it stays quiet.

## Color

Light theme ("graph paper"):

| Token | Hex | Use |
|---|---|---|
| `--paper` | `#F3F6F4` | page background, a cool green-grey like engineering paper |
| `--sheet` | `#FFFFFF` | drawers, dialogs, palette, popovers |
| `--ink` | `#1B2230` | primary text (14.7:1 on paper) |
| `--graphite` | `#5A6372` | secondary text, icons (5.6:1 on paper) |
| `--rule` | `#D5DDD8` | borders, row dividers, calendar grid |
| `--tie` | `#B8135F` | primary buttons, the "now" tick, focus rings, links (5.9:1 on paper) |
| `--soon` | `#8A5300` | due within 48 hours (5.8:1) |
| `--late` | `#B42318` | overdue, errors (6.0:1) |

Dark theme ("chalkboard"):

| Token | Hex |
|---|---|
| `--paper` | `#18211E` |
| `--sheet` | `#202B27` |
| `--ink` | `#E6ECE8` |
| `--graphite` | `#9FB0A9` |
| `--rule` | `#33443E` |
| `--tie` | `#F06AA6` |
| `--soon` | `#F2B45C` |
| `--late` | `#FF8A7A` |

Primary button text is `#FFFFFF` on light and `#18211E` on dark.

Course colors come from `courses.color` and `courses.color_dark` (seeded in `src/config/term-f26.ts`):

| Course | Light | Dark |
|---|---|---|
| STAT 230 | `#0F7B83` | `#5CC4CB` |
| CS 245 | `#5B4FD1` | `#A59BFF` |
| CS 246 | `#B7791F` | `#E3B25A` |
| CS 251 | `#2F7D3A` | `#7BC98A` |

Course colors mark things; they never color text. They appear as a 4px left bar on rows, an 8px dot in chips, a 12% tint behind chips and calendar events, and the fill of runway bars.

Urgency always pairs color with words ("overdue by 2 hours", "in 5 hours").

### Tokens in CSS

```css
@import "tailwindcss";

:root {
  --paper: #F3F6F4; --sheet: #FFFFFF; --ink: #1B2230; --graphite: #5A6372;
  --rule: #D5DDD8; --tie: #B8135F; --on-tie: #FFFFFF; --soon: #8A5300; --late: #B42318;
}
.dark {
  --paper: #18211E; --sheet: #202B27; --ink: #E6ECE8; --graphite: #9FB0A9;
  --rule: #33443E; --tie: #F06AA6; --on-tie: #18211E; --soon: #F2B45C; --late: #FF8A7A;
}

@theme inline {
  --color-paper: var(--paper);
  --color-sheet: var(--sheet);
  --color-ink: var(--ink);
  --color-graphite: var(--graphite);
  --color-rule: var(--rule);
  --color-tie: var(--tie);
  --color-on-tie: var(--on-tie);
  --color-soon: var(--soon);
  --color-late: var(--late);
  --font-sans: var(--font-ui), system-ui, sans-serif;
  --font-serif: var(--font-reading), Georgia, serif;
  --font-mono: var(--font-code), ui-monospace, monospace;
}
```

Map shadcn/ui variables onto these: `background` = paper, `card` and `popover` = sheet, `foreground` = ink, `muted-foreground` = graphite, `border` and `input` = rule, `primary` = tie, `primary-foreground` = on-tie, `ring` = tie, `destructive` = late. Theme follows the system setting, with a toggle in Settings.

## Type

All three families are in `next/font/google` (checked against Next 16.3.5).

| Role | Family | Settings |
|---|---|---|
| Interface | Atkinson Hyperlegible Next | 400 for body, 600 for titles, dates, and counts |
| Reading (notes, Ask answers, documents) | Source Serif 4 | 400 and 600, 18px, line height 1.65, max width 68ch |
| Code and math source | Atkinson Hyperlegible Mono | 400, code blocks and inline code only |

Atkinson Hyperlegible was designed for legibility, with letterforms that don't blur together (I, l, 1; O, 0), which suits a product whose first job is finding things fast. Notes switch to a serif because they're read for minutes at a time.

Scale (the classic typographic scale): 12, 14, 16, 18, 21, 24, 36px.

| Size | Use |
|---|---|
| 12 | fine print, source lines |
| 14 | metadata, table cells on mobile |
| 16 | interface body |
| 18 | reading text |
| 21 | section titles |
| 24 | page titles |
| 36 | the exam countdown on Today |

Rules: `font-variant-numeric: tabular-nums` on dates, times, countdowns, and grades. Sentence case everywhere. No all-caps labels. Left-aligned text; nothing centered except empty states.

## Layout

Breakpoints: mobile under 640px, tablet 640 to 1023px, desktop from 1024px.

- **Desktop**: a 232px left rail (app name, Today, Calendar, Inbox with count, Notes, Ask, Library, then the course list with color bars, then Settings at the bottom). The main column has a top bar with the search field and a Paste button. Content max width 1120px, left aligned.
- **Tablet**: the rail collapses to icons with tooltips.
- **Mobile**: a top bar (page title, search icon, More menu for Library and Settings), a row of course chips under it that scrolls sideways, and a bottom bar with Today, Calendar, Paste (center, filled with `--tie`), Notes, Ask. Course chips always open the course page.

Sample data in the wireframes below is illustrative.

Today, desktop:
```
+------------------+----------------------------------------------------------+
| Runway           |  [ Search everything                   Ctrl K ]  [Paste] |
|                  +----------------------------------------------------------+
| Today            |  Tuesday, September 15                                   |
| Calendar         |  Week 2. CS 251 midterm in 58 days                       |
| Inbox        3   |                                                          |
| Notes            |  Needs you: 2 changes to review, 1 paste due       [>]   |
| Ask              |                                                          |
| Library          |  Wednesday, September 30                                 |
|                  |  |  A1                    due 10:00 pm   in 15 days  Todo |
| Courses          |  |  CS 251, assignment                                   |
| | STAT 230       |  |  ----[=====|-------------------------]               |
| | CS 245         |                                                          |
| | CS 246         |  Changed recently                                        |
| | CS 251         |  CS 251 A2 moved from Oct 23 to Oct 26. From schedule, 2h|
|                  |                                                          |
| Settings         |                                                          |
+------------------+----------------------------------------------------------+
```

Today, mobile:
```
+----------------------------------+
| Today                   [Q] [..] |
| (STAT 230) (CS 245) (CS 246) (CS |
+----------------------------------+
| Tuesday, September 15            |
| Week 2                           |
|                                  |
| 2 to review, 1 paste due     [>] |
|                                  |
| Wed, Sep 30                      |
| |  A1, CS 251                    |
| |  Due 10:00 pm, in 15 days      |
| |  [=====|--------------------]  |
|                                  |
+----------------------------------+
| Today  Calendar  (Paste)  Notes  Ask |
+----------------------------------+
```

Course page, desktop:
```
+----------------------------------------------------------------+
| |  CS 251  Computer Organization and Design                    |
| |  Next: A1, Wed, Sep 30, in 15 days                           |
|    [Course site] [Schedule] [Outline] [Notes] [Crowdmark]      |
+----------------------------------------------------------------+
|  Overview   Deadlines   Notes   Ask   Resources   Updates  ... |
+----------------------------------------------------------------+
|  Next up                        |  Late policy                 |
|  A1         Sep 30   in 15 days |  No late work accepted       |
|  A2         Oct 23   in 38 days |                              |
|  Midterm    Nov 12   4:30 pm    |  Before you submit           |
|                                 |  [ ] Signed cover page first |
|  Coverage: 8 of 9 dated    [>]  |  [ ] Check page order        |
+----------------------------------------------------------------+
```

Note page, desktop, Compare view:
```
+----------------------------------------------------------------+
| |  STAT 230, Monday, September 28                              |
|    Conditional probability and Bayes' rule                     |
|    (conditional probability) (bayes rule) (independence)       |
|    [ Mine | Cleaned | Compare ]          [Edit] [Ask about it] |
+----------------------------------------------------------------+
|  Mine                         |  Cleaned                       |
|  p(a|b) = p(ab)/p(b), p(b)>0 |  P(A | B) = P(AB) / P(B) when  |
|  bayes flips teh condition    |  P(B) > 0. Bayes' rule flips   |
|                               |  the condition.                |
+----------------------------------------------------------------+
```

Inbox, mobile:
```
+----------------------------------+
| Inbox                            |
| +------------------------------+ |
| | Paste anything...            | |
| |                              | |
| +------------------------------+ |
| Course [Detect v]  Kind [Detect v] |
| [Paste from clipboard]   [Save]  |
|                                  |
| Review (2)                       |
| +------------------------------+ |
| | Update STAT 230 Quiz 2       | |
| | Oct 30  ->  Nov 6            | |
| | "Quiz 2 moves to Nov 6..."   | |
| | From LEARN, 2 hours ago      | |
| | [Approve] [Edit] [Dismiss]   | |
| +------------------------------+ |
+----------------------------------+
```

AI-off courses (CS 245, CS 246, CS 251 this term) show only the Mine view on note pages, with a line quoting the course's AI policy.

## The runway bar

- A 4px track (`--rule`) spanning the prep window: from runway start (due minus prep days) to due.
- Fill from runway start to now, in the course color.
- A 2px by 10px "now" tick in `--tie`.
- Before the window opens: track only, with "Prep starts Sep 23" beside it.
- Inside 48 hours: the fill turns `--soon`. Past due and not submitted: `--late`, plus "Overdue by 3 hours".
- Submitted: the track becomes dotted `--graphite` with a check icon; no tick.
- Sizes: 4px on Today rows, 2px in the Deadlines table, 6px with start and due dates labeled in the item drawer.
- Accessibility: `role="img"` with a label like "Prep window, day 4 of 7".
- The calendar shows the same idea as hatched prep blocks in the course color at low opacity.

## Components

- Base: shadcn/ui, restyled with the tokens.
- Radius: 6px for inputs and buttons, 10px for dialogs, drawers, and the palette, 0 for list rows and tables.
- Shadows only on overlays (dialog, drawer, palette, popover).
- Lists are rows divided by `--rule`, not cards. Cards appear in two places: review queue proposals (each one is a decision) and pinned link buttons.
- Kind labels are plain `--graphite` text. Exams get an outlined label so they stand out in lists.
- Icons: lucide-react, 18px, stroke 1.75.
- FullCalendar: map its CSS variables to the tokens. Events use ink text on a 14% course tint with a 3px left border in the course color. Exams use weight 600. Reminders have no fill and graphite text. Breaks are background events with a faint hatch. The "now" indicator uses `--tie`.
- Markdown: rendered in the reading font, with KaTeX for math and a mono code block on `--sheet` with a `--rule` border.

## Motion

Motion only answers an action:
- Approving or dismissing a proposal collapses its card (150ms).
- Marking an item submitted turns its bar dotted (200ms).
- Drawers and dialogs slide or fade in (150ms).

No entrance animations on page load. `prefers-reduced-motion` turns all of it off.

## Words

- Sentence case. Plain verbs.
- Buttons name the result: "Save note", "Approve", "Dismiss", "Paste now", "Run now", "Reconnect Google". The toast uses the same word ("Approved").
- Dates: "Wed, Sep 30" in lists, "Wednesday, September 30" in headings. Times: "5:00 pm". Unknown times: "time not set".
- Countdowns: "in 3 days", "in 5 hours", "overdue by 2 hours".
- Source lines: "From LEARN, synced 12 min ago".
- Empty states say what to do next: "No notes for CS 251 yet. Paste today's lecture notes." with the button beside it.
- Errors say what failed and how to fix it: "LEARN feed returned 401. Paste a new feed URL in Settings, Integrations."
- No em dashes, no arrows tacked onto button text, no dots between metadata fields (use commas or new lines), no eyebrow labels above headings.

## Accessibility floor

- WCAG AA contrast for all text (the token tables above pass on their backgrounds).
- Focus ring: 2px `--tie` outline, 2px offset, on every interactive element.
- Touch targets at least 44px.
- Keyboard: Ctrl/Cmd+K opens the palette, `/` focuses search, `g` then `t`, `c`, `i`, `n`, or `a` jumps to Today, Calendar, Inbox, Notes, or Ask, and `?` lists shortcuts.
- Every bar and chart has a text label for screen readers.

## Defaults this design avoids

Warm cream backgrounds with terracotta accents, near-black pages with one acid accent, grids of identical rounded cards with the same soft shadow, all-caps eyebrow labels, metadata joined with middle dots, monospace used for labels, and arrows appended to links. Check new screens against this list.
