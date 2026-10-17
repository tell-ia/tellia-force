# PROGRESS — demo date for the whole app

## Done
- 2026-10-17 Branch `feat/demo-date` from origin/main bbfa0fd. Chat-tools plan moved to `plans/`.
  Checked: everything in the API reads `registry.today()`; the engine works on past dates
  (15 Jul 2026: 3 fields to irrigate; 15 Jul 2021: none). The web dates were hard-coded text.
- 2026-10-17 Task 1: `settings/clock.ts` (demo date > DEMO_DATE > real date, kept in
  `data/demo-date.json`), `GET/PUT /settings/date`, `DemoDateState` in `@tellia/shared/app`,
  `registry.today()` reads the clock. 6 tests (advice and phone tools follow the date). Suite: 311 passed.
- 2026-10-17 Task 2: web `DateProvider` (GET/PUT /settings/date), `DateButton` + `DateSheet`
  (date input, 3 presets, real date), screens remount on a new date, fixed dates removed (Today,
  Parcel, Admin, Log; Log's chart window now by date, not `dayLabel >= 9`). Web: 58 passed.
- 2026-10-17 Task 3: Jean's prompt takes today from the tool results (never the real date);
  `vapi:setup` closes open SMS conversations on Jean's numbers. Docs: api CLAUDE.md, chat and vapi
  READMEs, .env.example. `vapi:setup` run by the agent (approved): Jean updated, 1 SMS conversation closed.
- 2026-10-17 Task 4 check found a bug: with no date in its prompt, Jean invented one
  (`get_farm_advice {date: 2024-06-13}`). Fix: the phone tools' `date` says "leave it out for today",
  the prompt says "never guess a date". Pushed; 3/3 VAPI chat runs call with no date and answer right.
- 2026-10-17 Task 4: end to end on the running API: PUT 2026-07-15 → advice asOf 2026-07-15
  (3 fields to irrigate), chat thread `member-1-2026-07-15`, tunnel OK, future date 400; VAPI
  chat API: Jean says 15 July and the 3 fields. Android rebuilt: chip "Wed 15 Jul 2026", sheet
  opens, "Wet summer" switches the app to 15 Jul 2021 (nothing urgent). Date reset to real.
  API 311 passed, web 58, shared OK.

## In progress

## Key decisions
- One server-side date for everyone (VAPI calls do not come from the app, so the app cannot send it).
- Saving irrigations on a past demo date is allowed.

## Blockers
