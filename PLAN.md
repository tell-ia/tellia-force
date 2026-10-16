# PLAN — VAPI phone assistant (branch `feat/vapi`)

Goal: a farmer calls the VAPI number (+1 218 845 6415) and talks in English with an
irrigation assistant. The assistant answers with numbers from our FAO-56 engine, through
tools that call our API.

## Spec
- VAPI sends every tool call to one URL: `POST /vapi/tools` on our API.
  - Body: `{ message: { type: "tool-calls", toolCallList: [{ id, function: { name, arguments } }], call } }`.
  - Answer: always HTTP 200, `{ results: [{ toolCallId, result | error }] }`, `result` a flat string.
- Auth: every VAPI tool sends header `x-vapi-secret` = `VAPI_WEBHOOK_SECRET`. Wrong or missing → 401.
- Caller: `call.customer.number` → `member.phone` → their farm.
  Unknown number (or web call) → default farm, read-only: `record_irrigation` is refused.
- Tools (fast path, no LLM, the irrigation service): `resolve_field`, `get_farm_advice`,
  `get_field_report`, `get_weather`, `get_irrigation_history`, `simulate_scenario`,
  `record_irrigation` (source `phone_call`, only after the farmer said yes out loud).
- Every tool result carries `today` (the API's date) so the assistant turns "yesterday" into a date.
- Public URL: team frp tunnel (see tell-ia-solutions `dev-tunnels.md`),
  `https://vincent-tellia-api.dev.review-time.info` → local API.
- VAPI config is code: `deno task vapi:setup` creates or updates the tools, the assistant
  "Tellia Irrigation" (English, voice and transcriber copied from the demo assistant) and links
  the phone number. Re-runnable. `--dry-run` prints the payloads.

## Tasks
- [x] 1. Env: `VAPI_PRIVATE_KEY`, `VAPI_WEBHOOK_SECRET`, `VAPI_SERVER_URL` (API, optional),
      `VITE_VAPI_PUBLIC_KEY` (web, optional); `.env.example` files; web `env.ts`.
- [ ] 2. VAPI module: tool table, `POST /vapi/tools`, member lookup by phone, mount in `main.ts`,
      unit tests on in-memory farms.
- [ ] 3. frp tunnel: `frpc.example.toml`, ignore `frpc.toml`, root `pnpm tunnel` script.
- [ ] 4. Setup script `apps/api/scripts/vapiSetup.ts` + `deno task vapi:setup`.
- [ ] 5. Run it: secret in `.env`, tunnel + API up, smoke test through the tunnel, run setup,
      test the assistant with the VAPI chat API.
- [ ] 6. Docs: `apps/api/src/modules/vapi/README.md`.

## Test rules
- Unit tests use in-memory farms only (`tests/helpers/testApp.ts`). Never run `test:live`.
- Never write to the shared Supabase DB from tests. Never run `seed --reset`.
