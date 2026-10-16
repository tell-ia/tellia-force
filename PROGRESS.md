# PROGRESS — VAPI phone assistant

## Done
- 2026-10-17 Worktree `tellia-force-2` on `feat/vapi` (from main b666762). Keys in `.env`.
  VAPI account had: demo assistant "Riley" (no tools), Twilio number not linked, no tools.
- 2026-10-17 Task 1: VAPI env vars (optional) in shared env schema, examples, web env.ts.
- 2026-10-17 Task 2: `POST /vapi/tools` (7 tools, x-vapi-secret, caller by phone), 9 tests; suite 139 pass.

## In progress

## Key decisions
- English only (user choice).
- Tunnel: team frp (user choice), not ngrok.
- New assistant "Tellia Irrigation"; the demo "Riley" is left as is.
- Unknown caller: default farm, read-only (no `record_irrigation`). Safer default; revisit for demo.

## Blockers
