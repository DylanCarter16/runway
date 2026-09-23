Fixtures for the paste inbox (Phase 3). Every text file is fake, written for Runway's tests; none is a real outline, announcement, schedule, or exam row.

- `quest-*.txt`, `odyssey-*.txt`: pastes for the rule-based parsers (no AI).
- `stat230-*.txt`: pastes for the Claude extraction path.
- `*.response.json`: Claude API responses in the recorded format for those pastes (`{ purpose, model, message }`). Tests replay them through `callClaude()` with a fake transport, so `npm run test` never calls the API. These were written by hand (2026-09-23) because the API key could not make live calls yet (docs/BLOCKED.md). Once it can, re-record with `.scratch/record-ai.ts` and check the tests still pass.
- `stat230-note.txt` (Phase 5): a messy lecture note with typos, LaTeX, an R code block, a `[?]` passage, a question, and a moved midterm. `stat230-note-cleanup.response.json` is the cleaned copy and `stat230-note-meta.response.json` the metadata, both written by hand like the others.
