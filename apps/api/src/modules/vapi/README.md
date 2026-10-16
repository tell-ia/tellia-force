# VAPI phone assistant

A farmer calls the VAPI number and talks (English) with the assistant "Jean".
VAPI runs the voice and the LLM; every number comes from our engine through tools.

```
phone → VAPI (speech, gpt-4.1, voice) → POST /vapi/tools → irrigation service → Supabase
```

## How a tool call works

- VAPI posts `{ message: { type: "tool-calls", toolCallList, call } }` to `/vapi/tools`.
- The header `x-vapi-secret` must equal `VAPI_WEBHOOK_SECRET`, or the answer is `401`.
  With no secret set, every request is refused.
- The caller is `call.customer.number` matched against `member.phone`.
  Unknown numbers and web calls get the default farm, **read-only**: `record_irrigation` is
  refused. Put your phone on a member (E.164, like `+33612345678`) to record.
- The answer is always `200` with `{ results: [{ toolCallId, result | error }] }`. `result` is a
  one-line JSON string and always has `today`.

Tools (`vapi.tools.ts`): `resolve_field`, `get_farm_advice`, `get_field_report`, `get_weather`,
`get_irrigation_history`, `simulate_scenario`, `record_irrigation` (source `phone_call`).

## Run it locally

1. `apps/api/.env`: `VAPI_PRIVATE_KEY`, `VAPI_WEBHOOK_SECRET` (`openssl rand -hex 24`),
   `VAPI_SERVER_URL` (your tunnel URL), `VAPI_PHONE_NUMBER`.
2. Start the API: `cd apps/api && deno task dev`.
3. Start the tunnel: copy `frpc.example.toml` to `frpc.toml`, set your name and the API port,
   `export FRP_TOKEN=...` (ask the team), then `pnpm tunnel` from the repo root.
4. Push the config to VAPI: `cd apps/api && deno task vapi:setup` (`--dry-run` to preview).
   Re-run it after changing a tool, the prompt, or the URL. It never deletes anything.

The VAPI wallet needs credits, or calls fail with `insufficient_credits`.

## Change the assistant

The system prompt, first message, model, voice, transcriber and noise settings are in
`apps/api/scripts/vapiSetup.ts`. Edit there and re-run `deno task vapi:setup`, not in the VAPI
dashboard: the script overwrites dashboard edits.
