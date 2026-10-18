# Chat and irrigation advisor: contract for teammates

The advisor tells the farm which field to water, when, how many mm and why. Every number comes from
a deterministic FAO-56 water balance (`modules/irrigation/engine/`). The LLM only runs the
conversation: it never computes numbers.

## Chat in the web app

`POST /chat` streams AI SDK v7 UI messages. `GET /chat/history` returns one conversation (see Sessions below), `GET /chat/threads` lists them.

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
   resource is `member-{id}`; the thread is chosen with `x-thread-id` (see Sessions).
4. **Render each tool part as a card.** The tool key is in the part type (`tool-<key>`). For each
   part: skeleton while the state is `input-available` / `input-streaming`, card when it is
   `output-available`, error card on `output-error`.
5. **The numbers on screen come from the cards, not from the assistant's text.** The text is a short
   summary; the card holds the authoritative values.

### Tool keys (UI card contract)

13 tools. Renaming a key breaks the UI. Output shapes are in `@tellia/shared/irrigation` (the first
8 rows) and `@tellia/shared/farm` (the 5 last rows and `IrrigationConfirmation`).

| Part type                   | Card                                                         | Output                                                                                                         |
| --------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `tool-resolveField`         | field chips                                                  | `{ matches: [{ fieldId, name, cropName }] }`                                                                   |
| `tool-getFarmAdvice`        | ranked advice list, most urgent first                        | `FarmAdvice` `{ asOf, reports: FieldReport[] }`                                                                |
| `tool-getFieldReport`       | one field: decision, mm, depletion, rain, reason             | `FieldReport`                                                                                                  |
| `tool-simulateScenario`     | what-if: baseline vs scenario and the comparison summary     | `ScenarioResult`                                                                                               |
| `tool-getWeather`           | weather strip, 3 days before to 3 days after                 | `{ fieldId, days: WeatherDay[] }`                                                                              |
| `tool-getIrrigationHistory` | confirmed irrigations, newest first                          | `{ fieldId, records: IrrigationRecord[] }`                                                                     |
| `tool-recordIrrigation`     | **confirmation card** with Yes / No buttons                 | `{ runId, status: "awaiting_confirmation", summary, fieldName, date, mm }`                                     |
| `tool-confirmIrrigation`    | saved / updated / deleted / cancelled badge                  | `IrrigationConfirmation` `{ status: "saved" \| "updated" \| "deleted" \| "cancelled", record? }`               |
| `tool-getFieldDetails`      | one field: area, crop today, irrigation system, soil         | `FieldDetails` `{ field, crop, irrigationSystem, soil }`                                                       |
| `tool-getFieldJournal`      | journal entries (planned ones marked) and the totals         | `FieldJournal` `{ fieldId, fieldName, type, from, to, entries, totals, truncated }`                            |
| `tool-checkProductUse`      | product verdict: uses, applications left, pre-harvest check  | `ProductCheck` `{ status, product, matches, authorised, uses, usage, applicationsLeft, ... }`                  |
| `tool-correctIrrigation`    | **confirmation card** with Yes / No buttons, before → after | `IrrigationCorrection` `{ runId, status: "awaiting_confirmation", summary, fieldName, action, before, after }` |
| `tool-lookupFarmData`       | one table: rows (at most 8 shown) and the server summary     | `FarmLookup` `{ table, synthetic, note, year, cropCode, rows, count, truncated, summary }`                     |

What the 5 farm tools answer (every number and total is computed by the server):

- `getFieldDetails` `{ fieldId }`: the field, the crop growing today (variety, sowing and expected
  harvest dates, previous crop), the irrigation system and the latest soil analysis (USDA texture
  class, pH, organic matter, N, P, K and more). Each part is `null` when there is none.
- `getFieldJournal` `{ fieldId?, type?, from?, to? }`: the farm journal (`operation` and its
  products). Default range: the field's crop season (sowing to harvest, plus the season's own rows
  before sowing, like its manure spread; `from` is then the first day covered); with no field, the
  last 365 days. Drafts and
  cancelled rows never show; rows after today are `planned: true`. At most 20 entries, newest first.
  `totals` cover the whole range (count per type, N / P2O5 / K2O kg/ha, irrigation mm, sprays);
  kg/ha and mm sums are `null` when the rows cover several fields.
- `checkProductUse` `{ product, fieldId, date? }`: finds the product by name or AMM number. `status`
  is `found`, `ambiguous` (the `matches`, no verdict) or `not_found`. Gives the E-Phy uses on the
  field's crop, the times used this season, `applicationsLeft`, `daysToHarvest` and `preHarvestOk`.
  `authorised` is `null` (no verdict) for products with no E-Phy data and for farms outside France.
  The crop stage (BBCH) is not checked: it is a warning.
- `correctIrrigation` `{ operationId, action: "update" | "delete", date?, mm? }`: starts the
  `correct-irrigation` workflow on a confirmed irrigation of the caller's farm (the model finds the
  `operationId` with `getIrrigationHistory`). Nothing changes yet. `after` is `null` for a delete.
- `lookupFarmData` `{ table, year?, cropCode?, limit? }`: one of `sale`, `market_price`, `subsidy`,
  `farm_economics`, `regional_benchmark`. Sales, subsidies and accounts are the caller's farm;
  market prices are global (`forecast: true` after the current month); benchmarks are the farm's
  region. `limit` ≤ 50 (default 20). `summary`: sales (tonnes, revenue, average price, per crop),
  subsidies (total, per year), `null` for the other tables. `synthetic: true` means demo data
  (`regional_benchmark` is real statistics, `false`).

**Confirmation card.** `tool-recordIrrigation` and `tool-correctIrrigation` mean nothing is saved or
changed yet. Show `summary` with Yes and No buttons. A button simply sends the user message `Yes`
or `No` through `useChat`; the assistant then calls `confirmIrrigation`, which finishes either kind
of run: `saved` (new irrigation), `updated` or `deleted` (correction), `cancelled` (the farmer said
no). Only confirmed irrigations count in the advice. A declined draft is deleted; a declined
correction changes nothing.

## Sessions (threads)

A member can have many conversations. The app picks one with the request header `x-thread-id`, on
`POST /chat`, `GET /chat/history` and `GET /chat/threads` alike (also in the CORS allow list).

- **Id format**: `member-{memberId}-{uuid}`, made by the client (`newThreadId` in `@tellia/shared`).
  The thread is created lazily by Mastra memory with its first message, so "New chat" taps leave
  nothing behind. The old day ids `member-{id}-{YYYY-MM-DD}` stay valid.
- **Isolation**: the id must start with the caller's `member-{memberId}-` and be `[A-Za-z0-9-]` up
  to 64 chars, and an existing thread must belong to `member-{memberId}`. Otherwise `403`
  (`http_403`, the `ApiError` envelope), for malformed, foreign and forged ids alike.
- **No header**: the member's most recently updated thread, else `member-{id}-{today}`.
- `GET /chat/threads` -> `{ data: ChatThreadSummary[] }` (`id`, `title` or `null`, `createdAt`,
  `updatedAt`), newest updated first. Titles come from `MODEL_MINI` shortly after the first reply;
  the app shows a fallback while `title` is `null` or a generic placeholder.
- `GET /chat/history` for a thread that does not exist yet answers `200` with no messages.

### Editing a sent message

`POST /chat/threads/:threadId/truncate` with `{ fromMessageId }` -> `{ data: { threadId, removed,
cancelledRuns } }` (`TruncateChatThread*Schema` in `@tellia/shared/app`). Conversation memory is
server-side, so a client-only edit would leave the old question and its replies in what the agent
recalls. The call deletes that message and every later one of the thread (`memory.deleteMessages`),
then the app sends the new text.

- **Flow in the app**: truncate, then `sendMessage({ text, messageId })`. In AI SDK v7 `messageId`
  replaces that user message in the client list and drops every later one; the request still carries
  the full list and Mastra saves messages by id, so the kept ones are not duplicated. Message ids in
  `GET /chat/history` are the ids the client sent (Mastra keeps them), so the id the app holds is
  the id the server deletes.
- **Checks**: same as `x-thread-id`. A forged, malformed or foreign thread id is `403`; an unknown
  thread or message is `404`; a message that is not a farmer message is `400`. Nothing is deleted
  on any error.
- **Confirmation cards in the removed messages** (`recordIrrigation` / `correctIrrigation`): if the
  run is still suspended (the farmer never answered) and belongs to the caller, the server answers
  "No" for them (`confirmed: false`: the draft is deleted, a correction changes nothing) and counts
  them in `cancelledRuns`. A card already answered is left alone: a saved, updated or deleted
  irrigation stays as it is, the edit never undoes it. A card before the edited message is not
  touched. A failed cancel is logged and ignored, the draft then stays as in "Unanswered drafts".

## `/irrigation` REST endpoints (no LLM, for VAPI and the UI)

VAPI webhooks must call these, **not `/chat`**, to stay under the 2 s voice budget. Send the same
`x-member-id` header to pick the caller's farm (default: farm 1's main contact); another farm's
field is `404`. Responses use the `{ data }` envelope.

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

## The five workflows

| Id                   | What it does                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `farm-advice`        | reports for every irrigable field in parallel, then ranks them                                                                                                                                                                                                                                                                                                                      |
| `simulate-scenario`  | applies what-if events (irrigation, rain, drought, flood, frost, hail) and compares with the baseline                                                                                                                                                                                                                                                                               |
| `record-irrigation`  | validates, saves a `draft` operation, then **suspends** for the farmer's yes/no. Resume with `confirmed: true` makes it `confirmed`; `false` deletes the draft. Only the same member can resume                                                                                                                                                                                     |
| `correct-irrigation` | validates the change (a `confirmed` irrigation of the caller's farm; the new day and mm pass the recording checks; the record moves to the crop season of its new day), then **suspends** with a before → after summary. `confirmed: true` updates or deletes it, only if the record still has the values of the question; `false` changes nothing. Only the same member can resume |
| `morning-warmup`     | cron `0 5 * * *` (Europe/Paris): computes all field reports so the first calls of the day hit the weather cache                                                                                                                                                                                                                                                                     |

`confirmIrrigation` finds which workflow owns the `runId` (`record-irrigation` or
`correct-irrigation`) and checks the member and the farm before it resumes the run.

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

## Demo date

"Today" for the whole project (chat instructions, the daily thread, every tool, VAPI) is
`registry.today()`: the date picked with the app's date chip (`GET/PUT /settings/date`, kept in
`data/demo-date.json`), else `DEMO_DATE`, else the real date in `TIMEZONE`. One date for everyone.
A new date closes the open VAPI SMS conversations (they remember the old day). Chat threads are
not tied to the date any more (see Sessions).

## Testing

`deno task test` is offline. `deno task test:live` calls the real model (about 12 chat turns, no
Supabase writes, in-memory farm) and needs `apps/api/.env`: `tests/live/chat_live_test.ts` covers
advice, scenario, recording and memory; `tests/live/chat_tools_live_test.ts` covers the 5 farm
tools, one turn per read tool and the correction flow (correct → `Oui` → `confirmIrrigation` →
`updated`). They check the tool calls and that the numbers in the reply come from the tools, never
the wording. `deno task smoke` queries a running server with two read-only questions.

## Unanswered drafts

When the farmer never answers a `recordIrrigation` confirmation, the draft stays as a `draft`
operation row. Drafts never count toward the water balance. Cleaning them up is backlog. An
unanswered `correctIrrigation` changes nothing: the record keeps its values.

## Mastra `/api/*`

Mastra's built-in `/api/*` routes have no auth, so they answer 404 (`http_404`, "Mastra API
disabled") unless `OPEN_MASTRA_API=true`. `/chat` and `/chat/history` are unaffected.
