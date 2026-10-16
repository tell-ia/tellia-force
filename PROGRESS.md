# PROGRESS — VAPI phone assistant

## Done
- 2026-10-17 Worktree `tellia-force-2` on `feat/vapi` (from main b666762). Keys in `.env`.
  VAPI account had: demo assistant "Riley" (no tools), Twilio number not linked, no tools.
- 2026-10-17 Task 1: VAPI env vars (optional) in shared env schema, examples, web env.ts.
- 2026-10-17 Task 2: `POST /vapi/tools` (7 tools, x-vapi-secret, caller by phone), 9 tests; suite 139 pass.
- 2026-10-17 Task 3: `frpc.example.toml` + `pnpm tunnel`; local `frpc.toml` → vincent-tellia-api → :8001.
- 2026-10-17 Task 4: `deno task vapi:setup` (+ `--dry-run`), schemas trimmed to basic JSON Schema. Dry run OK.
- 2026-10-17 Task 5: tunnel + API on :8001 up; webhook OK through the tunnel (401 without secret,
  ~1.1 s warm, 3.2 s cold). `vapi:setup` created 7 tools, assistant "Tellia Irrigation"
  (0daa12f7-facf-4d97-a37d-80dde93bd92f), linked +12188456415. Secret header kept by VAPI.
- 2026-10-17 Task 6: `apps/api/src/modules/vapi/README.md`.
- 2026-10-17 Assistant renamed "Jean" (name, prompt, first message) on VAPI and in the script.
- 2026-10-17 Jean: female voice Emma (v2), background sound off, Krisp denoising on. Pushed to VAPI.

## In progress

## Key decisions
- English only (user choice).
- Tunnel: team frp (user choice), not ngrok.
- New assistant "Jean" (user renamed it from "Tellia Irrigation"); the demo "Riley" is left as is.
- Unknown caller: default farm, read-only (no `record_irrigation`). Safer default; revisit for demo.

## Blockers
- Review the assistant's system prompt and first message (`apps/api/scripts/vapiSetup.ts`):
  first draft by the agent, AI-tuning is a human call.
- VAPI wallet balance is 0: the chat API test returned 402 insufficient_credits. Calls fail until
  credits are added (payment: human decision). End-to-end test not done yet.
- No member has a phone in the DB, so every caller is read-only on farm 1. To record by phone,
  set a member's phone (shared DB write: human decision).
