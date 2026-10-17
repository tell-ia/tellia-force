# PROGRESS — irrigation log in the app

## Done
- 2026-10-17 Branch `feat/irrigation-log` from origin/main a4179c6. Found: the Log screen never saved
  (`LIVE_WRITE = false`, fake success, from f4be07a), had no field picker, and no screen listed logs.
  Demo-date plan moved to `plans/`.
- 2026-10-17 Task 1: history never lists irrigations after today (REST, chat, phone share
  `service.listIrrigations`); `DELETE /irrigation/operations/:id` (confirmed, own farm). 2 REST tests.
  Also fixed main's tool-keys test (missing `showWidget`, b6d5710). API: 327 passed.
- 2026-10-17 Task 2: web saves for real (POST, errors shown, Undo = DELETE), `listIrrigations`;
  Log screen field chips + `#/log/:id` + real date + "See the log"; field page "Irrigation log"
  section + "Log watering" button + `#log` anchor. Web: 73 passed.
- 2026-10-17 Task 3 (emulator): field chips were squeezed to 0 height in the scrolling column
  (fixed: `flex: none`). Checked: chips switch the field, field page "Irrigation log" (20 rows, stops at
  today), "Log watering" opens the Log screen on that field. The real save is left to Vincent
  (agents never write the shared DB).
- 2026-10-17 Log screen: the watering's day can be changed (sowing to today) with a simple
  date field + popup month calendar (`components/ui/DateField.tsx`, Vincent's choice: classic,
  not the season calendar). Save and simulation use that day (`simulateDose` takes the day and
  today apart). The effect tiles use real dates (were fixed to the 15th/18th of 13 Jul 2022). Web: 76.
- 2026-10-17 Log screen: the field's "Irrigation log" card under the form (same component as
  the field page, no Log watering button there), reloaded after save / undo, the saved row
  highlighted; "See the log" scrolls to it. Web: 77.
- 2026-10-17 Log screen: a "Crop" row (crop growing today and its stage, "No crop growing"
  otherwise), via tested `cropLine` mapper. Web: 78.
- 2026-10-17 Chat Oui/Non card locks after an answer (and when already answered). Vincent tested the
  branch live; PR opened.

## In progress

## Key decisions
- Real saving from the Log screen is on (Vincent, 2026-10-17). It writes the shared DB.

## Blockers
