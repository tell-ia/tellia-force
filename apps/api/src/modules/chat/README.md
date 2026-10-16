# Chat and irrigation advisor: contract for teammates

The advisor tells the farm which field to water, when, how many mm and why. Every number comes from
a deterministic FAO-56 water balance (`modules/irrigation/engine/`). The LLM only runs the
conversation: it never computes numbers.

## Chat in the web app

`POST /chat` streams AI SDK v7 UI messages. `GET /chat/history` returns today's conversation.

1. **Load `GET /chat/history` first.** Response: `{ data: { threadId, messages } }`, where
   `messages` are v7 UI messages (empty list before the first chat). Pass them as the initial
   messages of `useChat`.
2. **Use `useChat` with `DefaultChatTransport`** pointing at `${API_URL}/chat`, with the header
   `x-member-id: <member id>`. Send **only the newest message**: the server keeps the thread (memory
   keeps the last 10 messages). Ids for memory sent in the body are ignored.
3. **Identity and farm.** `x-member-id` selects the farm member, and the member's farm scopes
   everything: fields, weather (the farm's region), records, and the reply language (Elena, member
   5, gets Spanish; Marco, member 9, Italian). Without the header the main contact of the first farm
   (member 1, Loiret) is used. An unknown id returns `400` with the `ApiError` envelope. Memory
   resource is `member-{id}` and the thread is `member-{id}-{YYYY-MM-DD}` (one conversation per
   member per day).
4. **Render each tool part as a card.** The tool key is in the part type (`tool-<key>`). For each
   part: skeleton while the state is `input-available` / `input-streaming`, card when it is
   `output-available`, error card on `output-error`.
5. **The numbers on screen come from the cards, not from the assistant's text.** The text is a short
   summary; the card holds the authoritative values.

### Tool keys (UI card contract)

Renaming a key breaks the UI. Output shapes are in `@tellia/shared/irrigation`.

| Part type                   | Card                                                     | Output                                                                     |
| --------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------- |
| `tool-resolveField`         | field chips                                              | `{ matches: [{ fieldId, name, cropName }] }`                               |
| `tool-getFarmAdvice`        | ranked advice list, most urgent first                    | `FarmAdvice` `{ asOf, reports: FieldReport[] }`                            |
| `tool-getFieldReport`       | one field: decision, mm, depletion, rain, reason         | `FieldReport`                                                              |
| `tool-simulateScenario`     | what-if: baseline vs scenario and the comparison summary | `ScenarioResult`                                                           |
| `tool-getWeather`           | weather strip, 3 days before to 3 days after             | `{ fieldId, days: WeatherDay[] }`                                          |
| `tool-getIrrigationHistory` | confirmed irrigations, newest first                      | `{ fieldId, records: IrrigationRecord[] }`                                 |
| `tool-recordIrrigation`     | **confirmation card** with Oui / Non buttons             | `{ runId, status: "awaiting_confirmation", summary, fieldName, date, mm }` |
| `tool-confirmIrrigation`    | saved / cancelled badge                                  | `{ status: "saved" \| "cancelled", record? }`                              |

**Confirmation card.** `tool-recordIrrigation` means nothing is saved yet. Show `summary` with Oui
and Non buttons. A button simply sends the user message `Oui` or `Non` through `useChat`; the
assistant then calls `confirmIrrigation`. Only confirmed irrigations count in the advice. A declined
draft is deleted.

## `/irrigation` REST endpoints (no LLM, for VAPI and the UI)

VAPI webhooks must call these, **not `/chat`**, to stay under the 2 s voice budget. Send the same
`x-member-id` header to pick the caller's farm (default: farm 1's main contact); another farm's
field is `404`. Responses use
the `{ data }` envelope.

| Method and path                                 | Purpose                                        |
| ----------------------------------------------- | ---------------------------------------------- |
| `GET /irrigation/advice?date=YYYY-MM-DD`        | ranked advice for all fields (`date` optional) |
| `GET /irrigation/fields/:fieldId/report?date=`  | one field report                               |
| `GET /irrigation/fields/:fieldId/weather?date=` | weather around the date                        |
| `POST /irrigation/fields/:fieldId/simulate`     | what-if, body `{ events, date? }`              |
| `POST /irrigation/operations`                   | record an irrigation (VAPI voice path)         |
| `GET /irrigation/operations?fieldId=&from=&to=` | irrigation history                             |

See `irrigation.controller.ts` for the exact schemas (shared Zod in `@tellia/shared/irrigation`). A
single application is capped at **35 mm** (`MAX_APPLICATION_MM`): advice never recommends more than
35 mm at once, and says to re-check after.

## The four workflows

| Id                  | What it does                                                                                                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `farm-advice`       | reports for every irrigable field in parallel, then ranks them                                                                                                                                  |
| `simulate-scenario` | applies what-if events (irrigation, rain, drought, flood, frost, hail) and compares with the baseline                                                                                           |
| `record-irrigation` | validates, saves a `draft` operation, then **suspends** for the farmer's yes/no. Resume with `confirmed: true` makes it `confirmed`; `false` deletes the draft. Only the same member can resume |
| `morning-warmup`    | cron `0 5 * * *` (Europe/Paris): computes all field reports so the first calls of the day hit the weather cache                                                                                 |

## Engine method and simplifications

FAO-56 daily root-zone water balance per field (`engine/`): depletion grows with crop
evapotranspiration (ET0 x Kc x stress) and shrinks with rain and **confirmed** irrigation. Soil
water capacity comes from Saxton-Rawls on the field's sand, clay and organic matter. Kc comes from
`crop_stage` by season fraction.

Simplifications:

- constant root depth per crop (no root growth);
- no runoff (all rain infiltrates, excess drains);
- the soil is at field capacity at sowing;
- the season fraction is the share of sowing-to-harvest growing degree-days (GDD); days still to
  come use the 2015-2024 GDD climatology.

## Security note

There is **no auth**, by team decision. As a consequence `/api/*` exposes Mastra's built-in routes
(agents, workflows, memory, schedules) to anyone who can reach the server, and `x-member-id` is
trusted as given. **Do not expose the server publicly.**

## Env

`MODEL` (default `openai/gpt-6.1-sol`), `MODEL_MINI` (`openai/gpt-6-luna`, thread titles),
`OPENAI_API_KEY`, `MASTRA_DB_URL` (LibSQL file), `DEMO_DATE`, `TIMEZONE`.

## Testing

`deno task test` is offline. `deno task test:live` calls the real model (about 10 calls, no Supabase
writes) and needs `apps/api/.env`. `deno task smoke` queries a running server with two read-only
questions.

## Unanswered drafts

When the farmer never answers a `record_irrigation` confirmation, the draft stays as a `draft`
operation row. Drafts never count toward the water balance. Cleaning them up is backlog.

## Mastra `/api/*`

Mastra's built-in `/api/*` routes have no auth, so they answer 404 (`http_404`, "Mastra API
disabled") unless `OPEN_MASTRA_API=true`. `/chat` and `/chat/history` are unaffected.
