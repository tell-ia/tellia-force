# PROGRESS — irrigation log in the app

## Done
- 2026-10-17 Branch `feat/irrigation-log` from origin/main a4179c6. Found: the Log screen never saved
  (`LIVE_WRITE = false`, fake success, from f4be07a), had no field picker, and no screen listed logs.
  Demo-date plan moved to `plans/`.
- 2026-10-17 Task 1: history never lists irrigations after today (REST, chat, phone share
  `service.listIrrigations`); `DELETE /irrigation/operations/:id` (confirmed, own farm). 2 REST tests.
  Also fixed main's tool-keys test (missing `showWidget`, b6d5710). API: 327 passed.

## In progress

## Key decisions
- Real saving from the Log screen is on (Vincent, 2026-10-17). It writes the shared DB.

## Blockers
