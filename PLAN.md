# PLAN — demo date for the whole app (branch `feat/demo-date`)

Goal: the presenter picks "today" from the date chip in the app. The whole project follows: app
screens, API, chat, VAPI calls and SMS. So the demo can show a dry week, a rainy week, a drought.

Approved by Vincent on 2026-10-17: one date for everyone (one presenter at the hackathon); saving
irrigations on a past demo date is allowed (it writes real rows dated that day).

## Spec

- **One server-side clock.** `registry.today()` (`apps/api/src/main.ts`) reads it. Value: the demo
  date if one is set, else `DEMO_DATE` from `.env`, else the real date in `TIMEZONE`.
  The demo date is kept in `apps/api/data/demo-date.json` (git-ignored) so it survives a restart.
- **Endpoints** (`modules/settings`): `GET /settings/date` → `{ today, realToday, demoDate, min, max }`;
  `PUT /settings/date` body `{ date: "YYYY-MM-DD" | null }` (null = back to the default).
  Range: `2015-01-01` (first weather day) to the real today. Contracts in `@tellia/shared/app`.
- **Web.** The date chip becomes a button that opens a "Demo date" sheet: a date input, presets
  (Very dry: 15 Jul 2026, Drought: 13 Jul 2022, Wet: 15 Jul 2021) and "Back to real today".
  A `DateProvider` holds the date; the app shell remounts the screens when it changes, so every
  screen reloads. Remove the hard-coded "Wed 13 Jul" texts and the `2022-07-14` fallbacks.
- **Chat** follows by itself (instructions and the daily thread use `registry.today()`).
- **VAPI.** Every tool result already carries `today`. Jean's prompt stops using the real date and
  uses the tool's `today`. `vapi:setup` also closes the open SMS sessions (they keep a copy of the
  old prompt). Then run `vapi:setup`.

## Safety
- Tests never write to Supabase and never touch `apps/api/data/demo-date.json` (the store is
  injectable). Offline suite: `cd apps/api && env -u RUN_DB_TESTS -u RUN_LIVE_TESTS deno task test`.

## Tasks
- [x] 1. Backend clock + `/settings/date` + shared contract + tests.
- [ ] 2. Web: `DateProvider`, date sheet, chips, remount on change, remove hard-coded dates, tests.
- [ ] 3. VAPI prompt uses the tool's `today`; `vapi:setup` closes open SMS sessions; docs. Run it.
- [ ] 4. End-to-end check (API, chat, VAPI tool result) and rebuild the Android app.
