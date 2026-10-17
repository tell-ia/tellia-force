# VAPI phone assistant

A farmer calls the VAPI number and talks (English) with the assistant "Jean". VAPI runs the voice
and the LLM; every number comes from our engine through tools. Jean helps with irrigation, and also
answers about the fields, the farm journal, crop protection products, and the farm's sales, prices,
subsidies and accounts.

```
phone → VAPI (speech, gpt-4.1, voice) → POST /vapi/tools → irrigation service → Supabase
```

## How a tool call works

- VAPI posts `{ message: { type: "tool-calls", toolCallList, call } }` to `/vapi/tools`.
- The header `x-vapi-secret` must equal `VAPI_WEBHOOK_SECRET`, or the answer is `401`. With no
  secret set, every request is refused.
- The caller is `call.customer.number` matched against `member.phone`. Unknown numbers and web calls
  get the default farm, **read-only**: `record_irrigation` and `correct_irrigation` are refused. Put
  your phone on a member (E.164, like `+33612345678`) to record or correct.
- The answer is always `200` with `{ results: [{ toolCallId, result | error }] }`. `result` is a
  one-line JSON string and always has `today`.

12 tools (`vapi.tools.ts`), the same use cases as the chat tools, with short flat results:

| Tool                     | What it does                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| `resolve_field`          | find fields by name or crop                                                               |
| `get_farm_advice`        | ranked irrigation advice for every field                                                  |
| `get_field_report`       | irrigation advice for one field                                                           |
| `get_weather`            | weather around a day                                                                      |
| `get_irrigation_history` | confirmed irrigations of a field, with their `operationId`                                |
| `simulate_scenario`      | what-if (rain, drought, flood, frost, hail, an irrigation); nothing is saved              |
| `get_field_details`      | the field, its crop today, irrigation system and latest soil analysis                     |
| `get_field_journal`      | what was done on a field or the farm, 10 entries at most, totals for the period           |
| `check_product_use`      | can this product go on this field's crop (E-Phy, France only); every warning              |
| `lookup_farm_data`       | sales, market prices, subsidies, accounts, regional averages; 10 rows at most             |
| `record_irrigation`      | **write**: save an irrigation (source `phone_call`), after the farmer's clear yes         |
| `correct_irrigation`     | **write**: change the day or mm of a recorded irrigation, or delete it, after a clear yes |

The phone has no `confirmIrrigation` step: Jean reads back the irrigation or the change, asks "Shall
I save it?" / "Shall I change it?", and calls the write tool only after a clear yes.

## Run it locally

1. `apps/api/.env`: `VAPI_PRIVATE_KEY`, `VAPI_WEBHOOK_SECRET` (`openssl rand -hex 24`),
   `VAPI_SERVER_URL` (your tunnel URL), `VAPI_PHONE_NUMBER`.
2. Start the API: `cd apps/api && deno task dev`.
3. Start the tunnel: copy `frpc.example.toml` to `frpc.toml`, set your name and the API port,
   `export FRP_TOKEN=...` (ask the team), then `pnpm tunnel` from the repo root.
4. Push the config to VAPI: `cd apps/api && deno task vapi:setup` (`--dry-run` to preview: it should
   list 12 tools). Re-run it after changing a tool, the prompt, or the URL, and after adding or
   renaming fields: it reads every farm's field names (read only, needs `SUPABASE_*`) and gives
   them to the transcriber so it spells them right ("Le Puits", not "Le Puy"). It never deletes
   anything. It also closes the open SMS conversations on Jean's numbers: VAPI keeps a copy of
   the assistant per conversation, so an open one would ignore the update. AI agents run only
   `--dry-run`; a human pushes.

The date: every tool result carries `today` (the app's demo date, see `/settings/date`). Jean's
prompt uses that date, never the real one, so calls and texts follow the app's date chip.
An open SMS conversation remembers the day it already read, so when the date changes the API
closes the open SMS conversations (`vapiSessions.ts`, needs `VAPI_PRIVATE_KEY`): the next text
starts a new conversation and Jean asks the tools again.

The VAPI wallet needs credits, or calls fail with `insufficient_credits`.

## Change the assistant

The system prompt, first message, model, voice, transcriber and noise settings are in
`apps/api/scripts/vapiSetup.ts`. Edit there and re-run `deno task vapi:setup`, not in the VAPI
dashboard: the script overwrites dashboard edits.
