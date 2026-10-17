# PROGRESS — demo date for the whole app

## Done
- 2026-10-17 Branch `feat/demo-date` from origin/main bbfa0fd. Chat-tools plan moved to `plans/`.
  Checked: everything in the API reads `registry.today()`; the engine works on past dates
  (15 Jul 2026: 3 fields to irrigate; 15 Jul 2021: none). The web dates were hard-coded text.
- 2026-10-17 Task 1: `settings/clock.ts` (demo date > DEMO_DATE > real date, kept in
  `data/demo-date.json`), `GET/PUT /settings/date`, `DemoDateState` in `@tellia/shared/app`,
  `registry.today()` reads the clock. 6 tests (advice and phone tools follow the date). Suite: 311 passed.

## In progress

## Key decisions
- One server-side date for everyone (VAPI calls do not come from the app, so the app cannot send it).
- Saving irrigations on a past demo date is allowed.

## Blockers
