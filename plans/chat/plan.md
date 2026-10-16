# Chat Backend (Mastra on Deno): Implementation Plan

> **For agentic workers:** use superpowers:subagent-driven-development or superpowers:executing-plans. Work task by task with TDD: write the listed tests, see them fail, implement, see them pass, commit. Update [progress.md](progress.md) and [todo.md](todo.md) at the end of every task.

**Goal:** A Deno backend where a farmer chats with a Mastra agent that gives irrigation advice: which field, when, how many mm, and why. Every number comes from a deterministic FAO-56 water balance. The AI never produces numbers.

**Architecture:** There are three layers.
1. **Deterministic core:** a pure FAO-56 engine, fed by Open-Meteo weather and farm data (seed parcels plus recorded irrigations), behind a small service layer.
2. **Mastra layer:** a single `advisor` agent, with memory per farmer and a streaming chat endpoint.
   - The agent's tools call the services directly for simple lookups, and run **Mastra workflows** for the multi-step use cases:
     - `farm-advice`: one report per parcel with `.foreach`, then a ranking.
     - `simulate-scenario`: the simulation, then a comparison.
     - `record-irrigation`: validate, then **suspend** for the farmer's yes or no, then save.
     - `morning-warmup`: scheduled at 05:00.
   - Workflows give durable confirmations (which work for chat and voice), plus a step-by-step trace for the demo.
3. **HTTP layer:** a Hono app on `Deno.serve` that exposes the chat, a `/v1` JSON API and CORS for Capacitor. The `/v1` API is a fast path with no LLM and no workflow overhead, shared with the UI and VAPI teammates.

**Tech stack, pinned:** Deno 2.7 · `@mastra/core` 1.78.0 · `@mastra/memory` 1.38.0 · `@mastra/libsql` 1.26.2 · `@mastra/hono` 1.7.20 · `@mastra/ai-sdk` 1.11.1 · `ai` 7.0.142 (test mocks only) · `hono` 4.13.13 · `zod` 4.6.7 · `@libsql/client` 0.18.0 · `@std/assert` 1.0.19 · Open-Meteo historical-forecast API (no key).

**Spec:** [`plans/plan.md`](../plan.md) for the product, and [`research/mastra/README.md`](../../research/mastra/README.md) for the verified Mastra findings. The verification spikes behind this plan are listed in [progress.md](progress.md#verified-before-planning-2026-10-16).

## Global Constraints

- All backend code lives in `backend/` and is run from inside it. Use the exact versions above, with no `latest` and no caret ranges.
- **The AI only runs the conversation; all numbers come from the calculation.** Tools return numbers. The agent's instructions forbid computing or guessing numbers.
- **Farmer isolation.** Identity comes only from the `Authorization: Bearer <token>` header, never from the request body. A farmer can only see and write their own parcels, memory threads and records.
- **Chat endpoint:** `POST /chat`, built with Mastra's `chatRoute` in AI SDK **v7** format. The UI depends on the tool keys `resolveParcel`, `getFarmAdvice`, `getParcelReport`, `simulateScenario`, `getWeather`, `recordIrrigation` and `confirmIrrigation`, which show up as `tool-<key>` message parts. Renaming a key breaks the UI.
- **No unconfirmed records:** an irrigation record from chat is saved only by resuming a suspended `record-irrigation` run with `confirmed: true`, by the same farmer who started it.
- **Hosting:** self-hosted Deno only, not Deno Deploy or edge isolates (issue #14503). `mastra dev` and Studio are Node-only and out of scope.
- **Language:** code, identifiers and engine "reason" sentences are in English. The agent replies in the farmer's language, French by default.
- **Tests:** no test may need an API key or the network. Use a scripted mock model (`MockLanguageModelV3` from `ai/test`) and a fake weather provider. `deno task test` type-checks test files too.

## Review Focus

These failure modes are the most likely to hurt a real user. Each is pinned by a test in the task named.

1. **Client-sent memory IDs.** A chat request whose body contains another farmer's memory resource or thread must still use only the authenticated farmer's thread. Covered in Task 10.
2. **Another farmer's parcel.** Farmer 1 asking for farmer 2's parcel, via a tool or REST, gets "not found". Covered in Tasks 7, 8 and 10.
3. **Confirming someone else's pending irrigation, or confirming twice.** Resuming another farmer's `record-irrigation` run must fail and save nothing. Confirming the same run a second time must not save a second record. Covered in Task 8.
4. **Timeline date before planting or after the season.** Returns `outside_season` and never sends an inverted date range to Open-Meteo. Covered in Task 7.
5. **First app open, no chat yet.** History returns an empty list, not a 500. Covered in Task 10.

---

## File map

| Path (under `backend/`) | Responsibility | Task |
|---|---|---|
| `deno.json`, `.env.example`, `.gitignore` | pinned imports, tasks (`dev`, `start`, `test`, `check`, `smoke`), fmt config | 1 |
| `src/config.ts` | env → typed config | 1 |
| `src/domain/util.ts` | date math + rounding | 1 |
| `src/domain/types.ts` | zod schemas: parcel, farmer, weather day, seed | 2 |
| `src/domain/fao56.ts` | crop + soil tables, Kc curve, TAW | 2 |
| `src/domain/waterBalance.ts` | daily root-zone depletion | 3 |
| `src/domain/report.ts` | decision, mm, reason sentence, ranking | 3 |
| `src/domain/scenario.ts` | what-if events (drought, flood, frost, hail, rain, irrigation) | 4 |
| `src/weather/openMeteo.ts` | Open-Meteo client + TTL cache | 5 |
| `data/seed.json` | demo farmers + parcels | 6 |
| `src/farm/repository.ts`, `resolveParcel.ts`, `irrigationStore.ts` | farm data, fuzzy parcel lookup, recorded irrigations | 6 |
| `src/services/errors.ts`, `advisor.ts` | the use cases shared by workflows, tools and REST | 7 |
| `src/mastra/workflows/farmAdvice.ts`, `simulateScenario.ts`, `recordIrrigation.ts`, `morningWarmup.ts`, `index.ts` | the four Mastra workflows + `createAdvisorWorkflows(services)` | 8 |
| `src/mastra/tools.ts` | the seven Mastra tools (direct or workflow-backed) | 9 |
| `src/mastra/advisor.ts` | agent, instructions, memory | 10 |
| `src/http/auth.ts`, `src/mastra/authMiddleware.ts` | bearer token → farmer, request-context keys | 11 |
| `src/mastra/index.ts` | builds the Mastra instance (agent + workflows + chat route) | 11 |
| `src/http/rest.ts`, `src/http/app.ts`, `src/main.ts` | `/v1` API, Hono app, wiring | 11 |
| `scripts/smoke.ts`, `README.md` | real-model latency check, teammate API contract | 12 |
| `tests/helpers/weather.ts`, `fixtures.ts`, `scriptedModel.ts` | constant weather; fake provider, test services and test Mastra; scripted mock model | 3, 7, 8, 10 |

## Shared reference values (used by many tests)

- **Reference parcel** `p-north`: maize, loam, planted 2026-04-01, at 43.6 N, 1.44 E.
  - TAW = 1000 × (0.25 − 0.12) × 1.2 m = **156 mm**.
  - p = 0.55, so RAW = **85.8 mm** and the stress threshold is 55%.
- **Reference weather:** constant ET0 of 5 mm per day, no rain, tmin 12 °C, from 2026-06-20 to 2026-07-12.
  - 2026-06-20 is day 80 after planting, which is mid-season, so Kc = 1.2 and ETc = **6 mm per day**.
- **Test "today":** **2026-07-05**. The balance runs from 06-20 to 07-04 (15 days), so depletion = **90 mm**, which is 58% of TAW.

---

## Task 1: Scaffold the Deno backend

**Build**
- Create the branch `feat/chat-backend`.
- Add `backend/deno.json`:
  - `nodeModulesDir: auto`.
  - Import map with the pinned versions, including the `@mastra/core/`, `@mastra/ai-sdk/` and `hono/` subpath mappings and `ai/test`.
  - Tasks: `dev`, `start` (both with `--env-file=.env`), `test` (`deno test -A`), `check` (type-check `src` and `tests`, plus lint), `smoke`.
  - fmt: single quotes, no semicolons, width 100.
- Add `.env.example`, which documents:
  - `ANTHROPIC_API_KEY`
  - `MODEL` (default `anthropic/claude-haiku-5-5`)
  - `DEMO_DATE` (default `2026-07-05`)
  - `TIMEZONE` (`Europe/Paris`)
  - `PORT` (4111)
  - `OPEN_MASTRA_API` (false)
  - `CORS_ORIGINS` (`capacitor://localhost`, `http://localhost`, `https://localhost`, `http://localhost:5173`)
- Add `.gitignore` covering `node_modules`, `.env` and the database files under `data/`.
- **Config:** `loadConfig(env)` returns port, model, Mastra DB URL, domain DB URL, seed path, demo date, timezone, CORS origins list and the open-API flag.
  - It rejects a malformed `DEMO_DATE` and a non-integer `PORT`.
  - It trims and splits `CORS_ORIGINS`.
- **Utils:** `addDays`, `daysBetween` (both on ISO dates, computed in UTC), `todayIn(timeZone, now)`, `round1` and `round2`.

**Tests**
- `addDays` crosses month and year boundaries:
  - 06-30 + 1 = 07-01
  - 12-31 + 1 = next year's 01-01
  - 03-01 − 1 = 02-28
- `daysBetween(2026-04-01, 2026-06-20)` = 80, and the result can be negative.
- `todayIn`: 2026-07-04T23:30Z is 07-05 in Paris and 07-04 in UTC.
- `round1(156.00000000000003)` = 156.
- Config defaults apply, overrides are read, and a bad `DEMO_DATE` or `PORT` throws an error that names the variable.

**Done when:** `deno task test` passes. Commit.

---

## Task 2: FAO-56 crop and soil tables, Kc curve

**Build**
- **`types.ts`:** zod schemas, with their types, for:
  - ISO date
  - crop id (maize, tomato, potato, sunflower, winter_wheat)
  - soil texture (the 9 FAO textures)
  - stage (initial, development, mid_season, late_season)
  - weather day (date, et0, rain, tmin, tmax)
  - parcel (id, farmerId, name, nicknames, crop, plantingDate, soil, areaHa, lat, lon)
  - farmer (id, name, language, token of at least 8 characters)
  - seed (farmers + parcels)
- **`fao56.ts`:**
  - **Crops**, with the English and French label, Kc ini/mid/end, the four stage lengths, root depth and p:

    | Crop | Kc ini / mid / end | Stage days | Root depth | p |
    |---|---|---|---|---|
    | Maize | 0.3 / 1.2 / 0.6 | 30/40/50/30 | 1.2 m | 0.55 |
    | Tomato | 0.6 / 1.15 / 0.8 | 30/40/40/25 | 1.0 m | 0.40 |
    | Potato | 0.5 / 1.15 / 0.75 | 25/30/45/30 | 0.5 m | 0.35 |
    | Sunflower | 0.35 / 1.1 / 0.35 | 25/35/45/25 | 1.0 m | 0.45 |
    | Winter wheat | 0.7 / 1.15 / 0.3 | 30/140/40/30 | 1.5 m | 0.55 |

  - **Soils:** θFC and θWP use the midpoints of FAO-56 Table 19.
    - Loam is 0.25 / 0.12.
    - Sandy loam is 0.23 / 0.11.
    - Clay is 0.36 / 0.22.
    - The other textures are filled in the same way.
  - `kcOnDay(crop, dayIndex)` follows the four-stage curve (FAO-56 eq. 66): constant in the initial stage, linear through development, constant in mid-season, linear in late season. It returns `null` outside the season.
  - `totalAvailableWater(soil, crop)` = 1000 × (θFC − θWP) × root depth.
- The Data teammate reviews these values (see the todo list).

**Tests**
- Maize Kc:
  - day 0 is 0.3 (initial)
  - day 50 is 0.75 (development)
  - day 80 is 1.2 (mid)
  - day 135 is 0.9 (late)
  - day −1 and day 150 are `null`
- TAW: loam with maize is 156, sandy loam with tomato is 120.
- Sanity for every crop: 4 positive stage lengths and 0 < p < 1. For every soil, θFC > θWP.

**Done when:** these tests pass. Commit.

---

## Task 3: Water balance, parcel report, ranking

**Build**
- **Test helpers:**
  - `constantWeather(start, days, overrides)` builds a run of identical days.
  - `withDay(days, date, patch)` changes a single day.
- **`runWaterBalance`** takes crop, soil, planting date, weather, irrigations and an optional starting depletion, and returns one row per in-season day. Each row has date, et0, kc, stage, ks, etc, rain, irrigation, depletion, taw and raw.
  - Start at field capacity: depletion 0, or the given starting depletion.
  - Skip days outside the season.
  - Ks = (TAW − previous depletion) / ((1 − p) × TAW) when the previous depletion is above RAW. Otherwise Ks = 1.
  - ETc = Ks × Kc × ET0.
  - New depletion = previous − rain − irrigation + ETc, clamped to the range 0..TAW. Excess water drains, and runoff is ignored.
  - Irrigations on the same date add up. Weather is sorted by date first.
- **`buildParcelReport(parcel, weather, irrigations, asOf, extraWarnings)`:**
  - The morning depletion is the balance at the end of the day before `asOf`. If there is no history, it is 0.
  - "Forecast" means the days from `asOf` to `asOf + 6` (7 days). Forecast rain is summed over `asOf` to `asOf + 2`.
  - When tmin on `asOf` is below 0, the report adds the warning "Frost forecast today (min X °C)."
  - Decisions, in order:
    1. Out of season → `outside_season`, 0 mm.
    2. Depletion ≥ RAW:
       - frost today → `frost_hold`, with mm = round(depletion);
       - else, forecast rain ≥ half the need → `wait_for_rain`, 0 mm;
       - else `irrigate_today`, with mm = round(depletion), which refills to field capacity.
    3. Otherwise `no_irrigation`. `daysUntilIrrigation` is the first projected forecast day, counted from 1, where depletion reaches RAW, using future irrigations too. It is null if that doesn't happen within 7 days.
  - Output fields:
    - parcelId, parcelName, crop, asOf
    - stage, kc (2 decimals)
    - decision, irrigateMm
    - depletionMm, tawMm, rawMm (1 decimal)
    - depletionPct (integer)
    - daysUntilIrrigation, rainNext3DaysMm
    - reason, warnings
  - Also export a zod schema for the report and for a day row; the tools reuse them.
  - **Reason sentences**, exact templates:
    - irrigate: "Root zone is {pct}% depleted ({dep} of {taw} mm), above the {p}% stress threshold, and only {rain} mm of rain is forecast in the next 3 days."
    - wait: "Root zone is {pct}% depleted, but {rain} mm of rain is forecast in the next 3 days, enough to cover most of the {need} mm need."
    - no irrigation: "Root zone is only {pct}% depleted ({dep} of {taw} mm), below the {p}% stress threshold; irrigation expected in about {n} days." Drop the clause after the semicolon when n is null.
    - frost: "Frost is forecast today (min {t} °C): irrigate {need} mm once temperatures are above 0 °C."
    - outside the season: "No crop water need: {date} is outside the {crop} growing season."
- **`rankReports`** sorts by decision (irrigate_today, frost_hold, wait_for_rain, no_irrigation, outside_season), then by depletion % descending.

**Tests: water balance** (reference parcel and weather)
- 10 dry days end at a depletion of 60, ETc is 6 and Ks is 1.
- 20 mm of rain on day 3 and 30 mm of irrigation on day 5 give depletions of [6, 12, 0, 6, 0].
- On day 16, Ks = 66/70.2 and depletion = 90 + Ks × 6. Day 15 ends at 90.
- Weather that starts 7 days before planting gives only 3 rows, and the first has ETc 1.5 (Kc 0.3).
- With ET0 at 50, depletion never exceeds TAW.

**Tests: report** (`asOf` = 07-05 unless stated)
- `irrigate_today` with 90 mm, depletion 90, TAW 156, RAW 85.8, 58%, 0 mm rain, stage mid_season, Kc 1.2, and the exact sentence.
- 50 mm of rain on 07-06 gives `wait_for_rain` with 0 mm and 50 mm of forecast rain.
- `asOf` 06-30 gives `no_irrigation` with depletion 60, 38%, 5 days until irrigation, and the exact sentence.
- An irrigation of 30 mm recorded on 07-04 gives `no_irrigation` with depletion 60.
- tmin −1 on 07-05 gives `frost_hold` with 90 mm and the frost warning.
- `asOf` 2026-10-01 gives `outside_season`, with stage and Kc null.
- `asOf` 06-20, with no history, gives depletion 0, `no_irrigation`, `daysUntilIrrigation` null, and the sentence without the clause.
- Ranking orders the three reports as irrigate, then no_irrigation, then outside_season.

**Done when:** all domain tests pass. Commit.

---

## Task 4: What-if scenario events

**Build**
- Event schema, a discriminated union on `type`:
  - `irrigation`: date, mm (> 0, max 200)
  - `rain`: date, mm (> 0, max 300)
  - `drought`: date, days (1 to 30), et0Factor (1 to 2, default 1.3)
  - `flood`: date, mm (50 to 400, default 120)
  - `frost`: date, tmin (≤ 0, default −3)
  - `hail`: date
- `applyScenario(weather, irrigations, events)` returns new weather, new irrigations and warnings, and never mutates its inputs.
  - Rain and flood add rain on that day. A flood also warns: "Flood on {date}: soil saturated, do not irrigate until it drains."
  - Drought sets rain to 0 and multiplies ET0 by the factor (rounded to 1 decimal) for N days.
  - Frost lowers tmin to the event value.
  - Hail only warns: "Hail on {date}: check crop damage; this advice assumes an undamaged crop."
  - An irrigation event is appended.
  - An event whose dates are missing from the weather warns: "Ignored {type} on {date}: no weather data for that date."

**Tests**
- Rain adds 25 mm to the right day and the input array is unchanged.
- A flood with the default adds 120 mm plus the flood warning.
- A 3-day drought on a day with 2 mm of rain sets those days' ET0 to 6.5 and rain to 0, and leaves day 4 untouched.
- Frost uses the −3 default, hail warns, and irrigation is appended after the existing one.
- Rain on 2027-01-01 produces the "Ignored" warning.
- The schema rejects mm = 0, an unknown type, and a non-ISO date.

**Done when:** these tests pass. Commit.

---

## Task 5: Open-Meteo weather provider with cache

**Build**
- A `WeatherProvider` interface with `getDaily({ lat, lon, start, end })`, returning weather days.
- `parseDaily(json)` validates the response with zod and maps the daily arrays:
  - `et0_fao_evapotranspiration` to et0
  - `precipitation_sum` to rain, with null becoming 0
  - `temperature_2m_min` and `temperature_2m_max` to tmin and tmax
  - It drops days where et0, tmin or tmax is null.
- `createOpenMeteoProvider({ fetchFn, baseUrl, ttlMs, now })` calls `https://historical-forecast-api.open-meteo.com/v1/forecast`.
  - Query parameters: latitude, longitude, the four daily variables, `timezone=auto`, `start_date`, `end_date`.
  - It times out after 8 s.
  - It caches the in-flight promise by rounded lat/lon plus the date range, with a 6 h default TTL.
  - A non-OK response rejects with "Open-Meteo {status}: {body}", and failures are never cached.
- Why this endpoint: the forecast endpoint rejects dates older than about 3 months, while historical-forecast covers 2021 to today + 14 days. This was verified on 2026-10-16.

**Tests** (fake fetch, no network)
- A 3-day sample whose last day is null parses to 2 days with the correct mapping.
- The URL has the right host, coordinates, dates, `timezone=auto`, and the daily variable list includes the FAO ET0.
- Two identical calls make one fetch. After the TTL passes, a third call fetches again.
- A 400 response rejects twice in a row and makes 2 fetches, because errors are not cached.

**Done when:** these tests pass. Commit.

---

## Task 6: Farm data: seed, repository, parcel resolver, irrigation records

**Build**
- **`data/seed.json`:** demo farms near Toulouse that fit the 2026-07-05 demo date.

  | Farmer | Token | Parcels |
  |---|---|---|
  | `farmer-1`, Jean Martin (fr) | `demo-token-1` | `p-north` "Champ Nord" (nicknames nord, north field, grand champ): maize, loam, planted 2026-04-01, 12 ha |
  | | | `p-river` "Parcelle de la Rivière" (rivière, river): tomato, sandy loam, 2026-05-05, 3 ha |
  | | | `p-hill` "Coteau" (colline, hill): sunflower, clay, 2026-04-25, 8 ha |
  | `farmer-2`, Claire Dubois (fr) | `demo-token-2` | `p-south` "Champ Sud": potato, silt loam, 2026-04-01, 5 ha. Used for isolation tests. |

- **Repository:**
  - `loadSeed(path)` reads the file and validates it with zod.
  - `createFarmRepository(seed)` provides: list farmers, get farmer by id or by token, list a farmer's parcels, and get a parcel scoped to its farmer.
  - It throws on a parcel whose farmer is unknown, and on duplicate parcel ids.
- **`resolveParcel(parcels, query)`:**
  - Normalizes text: removes accents, lowercases, trims.
  - Scores each parcel:
    - 100 for an exact match on id, name or nickname
    - 60 when the query and a name contain one another
    - 40 for a crop name in English or French
    - otherwise 20 per shared word longer than 2 letters
  - Returns the matches with a positive score, best first.
- **Irrigation store:** records have farmerId, parcelId, date, mm, source (chat, voice or api), id and createdAt.
  - Two implementations of "add" and "list for a parcel, sorted by date": an in-memory one for tests, and LibSQL via `@libsql/client` with a `CREATE TABLE IF NOT EXISTS`.

**Tests**
- The seed loads 2 farmers.
- Token `demo-token-1` resolves to farmer-1, and an unknown token resolves to nothing.
- farmer-1 has p-north, p-river and p-hill in seed order. farmer-1 cannot get p-south, but farmer-2 can.
- The repository throws on an unknown farmer ("unknown farmer") and on a duplicate id ("duplicate parcel").
- Resolver:
  - "Champ Nord" → p-north first
  - "le champ du nord" → only p-north
  - "riviere" (no accent) → p-river first
  - "les tomates" → only p-river
  - "tournesol" → only p-hill
  - "xyz" and a blank string → nothing
- Store contract, run against **both** implementations (LibSQL on a temp file): after three adds, listing p-north returns its two records sorted by date, with an id and the source.

**Done when:** these tests pass. Commit.

---

## Task 7: Advisor services (the use cases shared by tools and REST)

**Build**
- Errors: `NotFoundError` and `ValidationError`.
- `createAdvisorServices({ farm, irrigations, weather, today })` returns:
  - `farm` and `today()`
  - `resolveParcel(farmerId, query)`, which returns parcels
  - `getParcelReport(farmerId, parcelId, asOf?)`
  - `getFarmAdvice(farmerId, asOf?)`, which returns `{ asOf, reports }` ranked
  - `simulateScenario(farmerId, parcelId, events, asOf?)`, which returns `{ asOf, baseline, scenario, series }`, where series covers `asOf − 14` to `asOf + 6` with rounded values
  - `getWeather(farmerId, parcelId, asOf?)`, which covers `asOf ± 3` days
  - `previewIrrigation(farmerId, { parcelId, date, mm })`, which runs the same checks as recording and returns `{ parcelId, parcelName, date, mm, summary }` without saving anything. The summary reads "Record {mm} mm on {parcelName} for {date}?". The `record-irrigation` workflow uses it.
  - `recordIrrigation(farmerId, { parcelId, date, mm, source })`
- Every method that takes a parcel first checks it belongs to the farmer, and otherwise throws `NotFoundError`. `asOf` defaults to `today()`.
- Weather is fetched from `min(plantingDate, asOf)` to `asOf + 7`, so the range is never inverted. Recorded irrigations are loaded for the parcel.
- `previewIrrigation` and `recordIrrigation` reject with `ValidationError` when:
  - the date is not in ISO format;
  - mm is ≤ 0 or > 200;
  - the date is after today.
- **Test fixtures:**
  - `TEST_TODAY` = 2026-07-05.
  - The seed URL.
  - A fake weather provider that filters days to the requested range, records every query, and rejects inverted ranges.
  - `makeTestServices(overrides)`, using the seed, the memory store, the reference weather and `TEST_TODAY`.
  - `tempDbUrl()`.

**Tests**
- Farm advice for farmer-1 returns only p-north, p-river and p-hill. p-north is `irrigate_today` with 90 mm, and the parcels to irrigate are sorted by depletion % descending.
- farmer-1 asking for p-south → `NotFoundError`.
- `asOf` 2026-03-01 (before planting) → `outside_season`, and every weather query has start ≤ end.
- Recording 30 mm on 07-04, then asking for the report → `no_irrigation` with depletion 60.
- Validation rejects mm 0, mm 250, a future date (message mentions "future") and a non-ISO date. farmer-2 recording on p-north → `NotFoundError`.
- `previewIrrigation` for 25 mm on p-north on 07-04 returns the summary "Record 25 mm on Champ Nord for 2026-07-04?", and the parcel's record list stays empty. It rejects a future date the same way recording does.
- A scenario with 50 mm of rain on 07-06: baseline `irrigate_today`, scenario `wait_for_rain`. The series runs from 06-21 to 07-11, 21 days.
- A hail scenario: the scenario warnings start with "Hail on 2026-07-05".
- Weather for p-river: 7 days, starting 07-02.

**Done when:** these tests pass. Commit.

---

## Task 8: Mastra workflows

**Why:** "Full Mastra". These workflows give:
- durable confirmations that survive between messages, and later between voice turns;
- a fan-out over parcels;
- a scheduled morning job;
- a step-by-step trace of each run.

Each step calls the deterministic services, so workflows never contain FAO-56 maths.

**Build**
- `createAdvisorWorkflows(services)` returns four committed workflows, keyed `farmAdvice`, `simulateScenario`, `recordIrrigation` and `morningWarmup`.
- **`farm-advice`.** Input: farmerId and an optional asOf.
  1. A **list-parcels** step resolves asOf (defaulting to today) and outputs one item per parcel.
  2. **`.foreach`** runs a parcel-report step, concurrency 4.
  3. A **rank** step outputs `{ asOf, reports }`, ranked the same way as the service.
- **`simulate-scenario`.** Input: farmerId, parcelId, events, optional asOf.
  1. A **simulate** step calls the service.
  2. A **compare** step adds a deterministic `comparison`: `{ decisionChanged, mmBefore, mmAfter, summary }`. The summary reads either:
     - "Scenario changes the decision from {a} ({x} mm) to {b} ({y} mm)."
     - "Scenario keeps {a}; irrigation {x} mm → {y} mm."
- **`record-irrigation`.** Input: farmerId, parcelId, date, mm, source.
  1. A **validate** step calls `previewIrrigation`. A validation or not-found error fails the run.
  2. A **confirm** step:
     - **suspends** with the payload `{ summary, parcelId, parcelName, date, mm }`, resume schema `{ confirmed: boolean }`;
     - on resume, rejects unless the resuming request context's `farmerId` equals the input farmerId.
  3. A **save** step:
     - when confirmed, calls `recordIrrigation` and outputs `{ status: 'saved', record }`;
     - otherwise outputs `{ status: 'cancelled' }`.
- **`morning-warmup`.** Input: empty.
  1. A **list-farmers** step.
  2. **`.foreach`** runs a warm-farmer step. It calls the farm advice service, catches errors, and outputs `{ parcels, failed }`.
  3. A **summarize** step outputs `{ farmers, parcels, failures }`.
  - Schedule: cron `0 5 * * *`, timezone Europe/Paris. The schedule id is `wf_morning-warmup`.
  - Why: the product plan wants heavy work done before calls. Running this at 05:00 fills the 6 h weather cache.
- **Test fixture** `makeTestMastra(services, model?)`: a Mastra instance with the four workflows, a temp LibSQL store, and the agent once Task 10 exists. The first version only registers the workflows.
- Verified on Deno with core 1.78.0 (spike 2026-10-16):
  - start → `status: 'suspended'`, with `runId` and `suspendPayload` keyed by step id;
  - a fresh `createRun({ runId })`, then `resume({ step, resumeData, requestContext })` → success, and the later steps see the resuming request context;
  - `.foreach` outputs an array, and `.parallel` outputs an object keyed by step id;
  - a tool's `execute` context includes `mastra`.

**Tests** (run each workflow through `makeTestMastra`)
- **farm-advice** for farmer-1 → success. Three reports, p-north `irrigate_today` with 90 mm, same order as the service.
- **simulate-scenario** with 50 mm of rain on 07-06 → `decisionChanged` is true, mmBefore 90, mmAfter 0, and the summary names both decisions.
- **record-irrigation, happy path:**
  - Start for farmer-1, 25 mm on p-north on 07-04 → suspended, with the summary "Record 25 mm on Champ Nord for 2026-07-04?" and nothing saved.
  - Resume from a **fresh** run handle by runId with confirmed true and a farmer-1 context → saved, and the parcel now has 1 record.
- **record-irrigation, declined:** resume with confirmed false → cancelled, 0 records.
- **record-irrigation, wrong farmer:** resume with a farmer-2 context → the run fails or rejects, with 0 records.
- **record-irrigation, double confirm:** resume the same run with confirmed true a second time → still exactly 1 record, whether it errors or not.
- **record-irrigation, invalid input:** a future date → the run fails at validate and never suspends.
- **morning-warmup** → `{ farmers: 2, parcels: 4, failures: 0 }`. With farmer-2's advice throwing → `{ farmers: 2, parcels: 3, failures: 1 }`.

**Done when:** these tests pass. Commit.

---

## Task 9: Mastra tools

**Build**
- `farmerIdFrom(ctx)` reads `farmerId` from the tool's request context and throws if it is missing.
- `createAdvisorTools(services)` returns seven tools, each with zod input and output schemas reused from the domain and workflow schemas.
  - Workflow-backed tools get the Mastra instance from the tool context (`ctx.mastra`). They start a run, passing the request context. A run that does not succeed becomes a thrown error carrying the run's error message.

  | Key (UI contract) | Tool id | Input | Backed by |
  |---|---|---|---|
  | `resolveParcel` | `resolve_parcel` | query | service |
  | `getParcelReport` | `get_parcel_report` | parcelId, optional date | service |
  | `getWeather` | `get_weather` | parcelId, optional date | service |
  | `getFarmAdvice` | `get_farm_advice` | optional date | `farm-advice` workflow |
  | `simulateScenario` | `simulate_scenario` | parcelId, 1 to 10 events, optional date | `simulate-scenario` workflow; output includes `comparison` |
  | `recordIrrigation` | `record_irrigation` | parcelId, date, mm | starts `record-irrigation`; returns `{ runId, status: 'awaiting_confirmation', summary, parcelName, date, mm }` |
  | `confirmIrrigation` | `confirm_irrigation` | runId, confirmed | resumes that run with the caller's request context; returns `{ status: 'saved' \| 'cancelled', record? }` |

- Descriptions are written for the model.
  - recordIrrigation: "starts a confirmation, ask the farmer the summary question".
  - confirmIrrigation: "call only with the farmer's explicit yes/no answer".
- Verified behavior with core 1.78.0: an error thrown inside a tool reaches a direct caller, and invalid input returns `{ error: true, message }`.

**Tests** (call each tool's `execute` directly, with a context holding the request context **and** the test Mastra)
- `farmerIdFrom` returns the id when present and throws when absent.
- The tool keys are exactly the seven above.
- `resolveParcel` "champ nord" returns p-north / Champ Nord / maize first.
- `getParcelReport` for p-north returns `irrigate_today` with 90 mm. p-south, or a context with no farmer, rejects.
- `getFarmAdvice` returns 3 reports.
- `simulateScenario` with 50 mm of rain returns a `wait_for_rain` scenario and `comparison.decisionChanged` true.
- `getWeather` returns 7 days.
- `recordIrrigation` of 30 mm on 07-04 → awaiting_confirmation with a runId, and nothing saved yet.
  - Then `confirmIrrigation` with that runId and confirmed true → saved.
  - The next report shows depletion 60.
- `confirmIrrigation` called with farmer-2's context on farmer-1's run → rejects, and nothing is saved.
- Simulate with an empty event list → error object.

**Done when:** these tests pass. Commit.

---

## Task 10: Advisor agent

**Build**
- `ADVISOR_ID` = `advisor`.
- `buildInstructions(services, farmerId)`:
  - **Unknown farmer:** a short prompt saying the user is not authenticated, not to call tools, and to ask them to sign in.
  - **Known farmer:**
    - who they are, and today's date
    - the default language
    - their parcels, as "- {name} (id {id}, {crop}, {area} ha)"
    - the rules below

    **Rules:**
    1. Never compute or guess numbers. Every number is copied from a tool result.
    2. Which tool to use: farm advice for "what should I water", the parcel report for a single parcel, weather for weather questions.
    3. Reply in the farmer's language and keep it short: the decision and mm first, then the tool's reason, translated with the numbers unchanged.
    4. When the farmer reports watering:
       - resolve the parcel;
       - call recordIrrigation;
       - ask the returned summary as a yes/no question, in their language;
       - on a clear answer, call confirmIrrigation with that runId.
       - Never call confirmIrrigation without an explicit answer. If they give minutes instead of mm, ask for mm first.
    5. Questions about drought, rain, flood, frost, hail, or "what if I water…" go to `simulateScenario`. Use its comparison summary.
    6. If the parcel is ambiguous, resolve it and ask. Never invent a parcel. If a tool fails, say so briefly.
    7. Mention any warnings the tools return.
- `createAdvisorAgent({ services, model })`:
  - Dynamic instructions that read `farmerId` from the request context.
  - The seven tools.
  - Mastra Memory with the last 20 messages and working memory in template mode: language, parcel nicknames, preferences. Template mode is the one tested on Deno.
  - The model is a router string in production, and the scripted mock in tests.
- **Test helper `scriptedModel(steps)`:** a `MockLanguageModelV3` that serves both generate and stream. Each call consumes the next step, either some tool calls or a text. It records the prompts it receives, and answers "OK." once the script runs out.
- Extend `makeTestMastra` to register the agent when a model is given.

**Tests**
- The instructions for farmer-1 contain:
  - "Jean Martin"
  - "Champ Nord (id p-north, maize, 12 ha)"
  - "Today is 2026-07-05"
  - "Never compute or guess numbers"
  - "confirmIrrigation"

  They do not mention p-south.
- The instructions for an unknown farmer contain "not authenticated".
- **Advice run.** The script calls getFarmAdvice, then returns the text "Arrosez le Champ Nord : 90 mm.". Generating with farmer-1 in the request context:
  - returns that text;
  - the farm-advice workflow ran for farmer-1 (spy on the services);
  - the first prompt contained "Jean Martin".
- **Confirmation across two turns.** Turn 1's script: call recordIrrigation (p-north, 07-04, 25 mm), then text. No record is saved. Turn 2's script: call confirmIrrigation with the runId from turn 1's tool result, then text. One record is saved.
  - Inside the scripted model, read the runId from the tool result in the prompt. Or run turn 2 by calling confirmIrrigation's `execute` with that runId, whichever the mock allows.

**Done when:** these tests pass. Commit.

---

## Task 11: HTTP app: chat, auth, CORS, history, /v1 REST, schedule, main

**Build**
- **Auth:** `farmerFromAuthHeader(farm, header)` parses "Bearer <token>" and looks up the farmer.
- **Mastra middleware** runs inside Mastra's server for `/chat*` and `/api/*`:
  - It passes OPTIONS through.
  - It returns 401 when there is no valid token. For `/api/*` it lets the request through instead when `OPEN_MASTRA_API` is true.
  - On a valid token it sets, in the request context:
    - Mastra's reserved resource id key = farmer id;
    - the reserved thread id key = `{farmerId}-{today}`;
    - `farmerId`.

  Because these keys are reserved, Mastra ignores memory ids sent in the body. This was verified in a spike.
- **`createMastra({ services, model, storageUrl, openMastraApi })`:**
  - the advisor agent
  - the four workflows
  - LibSQL storage
  - `chatRoute` at `/chat` with the fixed advisor agent, `version: v7` and max 6 steps by default
  - the middleware
- **`/v1` REST router**, a Hono sub-app. This is the fast path: it calls the services directly, with no workflow.
  - Its own bearer check, which returns 401 and stores the farmer id.
  - Error mapping: not found → 404; validation, zod or invalid JSON → 400; anything else → 500 and logged.
  - Routes:
    - GET parcels
    - GET advice (optional `date`)
    - GET a parcel report (optional `date`)
    - GET parcel weather (optional `date`)
    - POST simulate, with body events (1 to 10) and an optional date
    - POST irrigations, with body parcelId, date and mm, source "api", returning 201. An explicit form submit counts as confirmation.
- **`createApp({ mastra, services, corsOrigins })`:**
  - CORS on everything for the configured origins, allowing the Authorization and Content-Type headers and GET, POST and OPTIONS.
  - `GET /health` returns ok and today.
  - The `/v1` router.
  - `GET /chat/history`:
    - It checks the token itself, because it is registered before Mastra.
    - It finds today's thread. If the thread is missing or not owned by the farmer, it returns an empty list.
    - Otherwise it recalls the messages and converts them to AI SDK v7 UI messages.
  - Finally it initializes Mastra's Hono server on the same app.
- **`main.ts`:**
  - Load the config and create `./data`.
  - Build the services: the seed repository, the LibSQL irrigation store, the Open-Meteo provider, and "today" = the demo date or the real date in the configured timezone.
  - Build Mastra and the app, then `Deno.serve`.
  - Call `mastra.startWorkers()`, without which the 05:00 schedule never fires.
  - Log the port, today and the model.

**Tests** (`app.request`, scripted model, temp DB)
- `/health` is public and returns `{ ok: true, today: 2026-07-05 }`.
- A CORS preflight on `/chat` from `capacitor://localhost` returns 204 with that origin allowed.
- `POST /chat` with no token → 401.
- **Chat ignores client-supplied memory ids.** Send a chat as farmer-1 whose body claims farmer-2's resource and a "stolen" thread:
  - The response is a 200 event stream.
  - The stream contains a tool-output part with p-north and the scripted text, and never mentions p-south.
  - Memory then has exactly one thread for farmer-1 (`farmer-1-2026-07-05`) and none for farmer-2.
- **History is empty before the first chat.** History is first an empty list. After one chat it has 2 messages: the user's, then an assistant message with a `tool-getFarmAdvice` part.
- `/v1/advice` with no token → 401. With a token → 3 reports. The p-south report → 404.
- Simulate with a 5-day drought → 200 with a non-empty series.
- Irrigation with mm −5 → 400. Valid → 201. Malformed JSON → 400.
- `/api/agents` with no token → 401, with a token → 200.
- After `startWorkers()`, `GET /api/schedules` with a token lists `wf_morning-warmup`. If this Mastra version serves it under a different route, assert on that route and note it in progress.md.

**Manual check:** run `deno task start` (no LLM key needed), then call `/health` and `/v1/advice` with demo-token-1. You should get real Open-Meteo-based reports for 3 parcels.

**Fallbacks** (record in progress.md if used):
- If Mastra's middleware typing clashes with the app's Hono types, cast at the call site.
- If the memory "get thread by id" call is unavailable, use list-threads filtered by resource, which was verified.

**Done when:** the app tests, the full suite and `deno task check` all pass. Commit.

---

## Task 12: Real-model smoke test, latency, teammate API contract

**Build**
- **`scripts/smoke.ts`:**
  - Posts one question to `/chat` with a demo token.
  - Reads the SSE stream line by line, buffering partial lines, and prints each tool call with its time.
  - Prints the final text, then the time to first byte, first text and total.
- **`backend/README.md`**, the contract for teammates:
  - **Run:** run commands and demo tokens.
  - **Chat (Capacitor):**
    - Load `/chat/history` first.
    - Configure `useChat` with `DefaultChatTransport` pointing at `/chat`, with the bearer header, sending only the newest message.
    - Map each tool part type to its card: skeleton while the input is available, card when the output is available, error card on an error. This includes the `tool-recordIrrigation` confirmation card with Yes/No buttons. Each button sends "oui" or "non" as a chat message.
    - Document the report fields and the decision values.
    - Say that the numbers on screen come from the card, not the assistant text.
  - **`/v1` reference:** list the endpoints. Say that VAPI tool webhooks should call `/v1/advice`, not the LLM chat, to stay under 2 s.
  - **Workflows:** list the four workflows and what each does.
  - **Model:** summarize the method and its simplifications: constant root depth, no runoff, field capacity at the first day with data.

**Manual check** (needs an LLM key):
1. "Quel champ dois-je arroser aujourd'hui ?" → calls getFarmAdvice and answers in French with the tool's mm.
2. "Et si une sécheresse de 5 jours commence aujourd'hui sur le champ nord ?" → calls simulateScenario and uses the comparison.
3. "J'ai arrosé le champ nord hier, 25 mm", then "oui" → turn 1 calls recordIrrigation and asks; turn 2 calls confirmIrrigation, and the record exists.

Write the timing lines into progress.md under Latency.

**Done when:** the README is committed, the latency is recorded, and the todo hand-offs are sent.

---

## Self-review

- **Coverage of the product plan's backend list:**

  | Product plan item | Covered in |
  |---|---|
  | Chat (Full Mastra) | Tasks 8 to 11 (agent, workflows, chat route) |
  | Get Weather | Tasks 5 and 9 |
  | Advice endpoint | Task 7, plus `/v1/advice` in Task 11 and the `farm-advice` workflow |
  | `resolve_parcel`, `get_parcel_report`, `simulate_scenario` | Tasks 6 to 9 |
  | Edge cases (drought, flood, frost, hail) and moving the timeline | Task 4, plus the `date` parameter everywhere |
  | Farmer-reported watering | the `record-irrigation` workflow with suspend/resume confirmation |
  | One-sentence reason | Task 3 |
  | Precompute before calls | `morning-warmup` |

- **Out of scope:** VAPI webhook, Twilio, SMS and WhatsApp (separate owner), the Capacitor UI, the real hackathon dataset adapter. See the todo backlog.
- **Names used consistently across tasks:**
  - the seven tool keys
  - the four workflow ids (`farm-advice`, `simulate-scenario`, `record-irrigation`, `morning-warmup`)
  - `ADVISOR_ID`
  - thread id `{farmerId}-{date}`
  - `TEST_TODAY`
  - seed ids `farmer-1`/`farmer-2` and `p-north`/`p-river`/`p-hill`/`p-south`
  - the reference numbers 156, 85.8, 90, 60, 58% and 38%
