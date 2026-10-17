# PLAN — irrigation log in the app (branch `feat/irrigation-log`)

Goal: a farmer logs a watering from any field, it is really saved, and they can see past logs.
Approved by Vincent on 2026-10-17: turn on real saving from the Log screen (writes the shared DB).

## Spec
- **API**
  - The irrigation history (REST `GET /irrigation/operations`, chat `getIrrigationHistory`, phone
    `get_irrigation_history`) stops at "today": no rows after the demo date.
  - `DELETE /irrigation/operations/:operationId`: deletes a confirmed irrigation of the caller's farm
    (same rules as `correctIrrigation` delete). Used by the Log screen's Undo.
- **Web**
  - Log screen really saves (`POST /irrigation/operations`), shows errors (no fake success), Undo
    deletes the saved row, "See the log" opens the field page.
  - Log screen has field chips (default: the most urgent field); route `#/log/:fieldId` opens it on a field.
  - Field page: an "Irrigation log" section (saved irrigations, newest first) and a "Log watering"
    button (`#/log/:fieldId`). Anchor `#log` scrolls to it.

## Safety
- Tests never write to Supabase (in-memory farms). Offline API suite:
  `cd apps/api && env -u RUN_DB_TESTS -u RUN_LIVE_TESTS deno task test`. Web: `pnpm check-types && pnpm test`.

## Tasks
- [x] 1. API: history capped at today + `DELETE /irrigation/operations/:id` + tests.
- [x] 2. Web: real save + Undo + list API; Log screen field chips + `#/log/:id`; field page log section; tests.
- [x] 3. Check on the emulator; PR.
