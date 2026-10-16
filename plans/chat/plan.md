# Chat & Irrigation Advisor (Mastra in `apps/api`): Implementation Plan

> **For agentic workers:** work task by task with TDD: write the listed tests, see them fail, implement, see them pass, then commit. No code appears in this plan; the behavior, names and expected values are what you must match. Update [progress.md](progress.md) and [todo.md](todo.md) after each task, unless your stage's instructions say otherwise.

**Goal:** inside the existing Deno + Hono API, build:
- an irrigation advisor that tells the farm which field to water, when, how many mm, and why;
- a Mastra chat agent and Mastra workflows on top of it.

Every number comes from a deterministic FAO-56 water balance. The AI never produces numbers.

**Architecture:** there are four layers, all inside `apps/api`.
1. **Deterministic engine** (`modules/irrigation/engine/`): pure functions, no I/O.
2. **Data and weather layer:**
   - Supabase tables, behind a `FarmData` interface with an in-memory twin for tests;
   - Open-Meteo, which fills the days the DB doesn't have yet (the gap after the last stored day, plus the 7-day forecast).
3. **Use-case service** (`irrigation.service.ts`), shared by:
   - a fast REST module `/irrigation`, which uses no LLM;
   - the Mastra layer (`modules/chat/`): one `advisor` agent with memory per member, a streaming `POST /chat` (AI SDK v7), and four Mastra workflows. These are `farm-advice`, `simulate-scenario`, `record-irrigation` (suspend for the farmer's yes/no) and `morning-warmup` (05:00).
4. **Shared contracts:** everything that crosses the wire lives in `@tellia/shared` (`packages/shared/src/irrigation.ts`).

**Tech stack** (versions pinned exactly for the new deps):
- Deno 2.7, with the repo's `sloppy-imports`.
- Hono 4, with `@hono/zod-validator`.
- zod 4.
- `@supabase/supabase-js`.
- `@mastra/core` 1.78.0, `@mastra/memory` 1.38.0, `@mastra/libsql` 1.26.2, `@mastra/hono` 1.7.20, `@mastra/ai-sdk` 1.11.1.
- `ai` 7.0.142, for test mocks only.
- Open-Meteo historical-forecast API, which needs no key.

**Spec and context:**
- [`plans/plan.md`](../plan.md), the product plan.
- [`research/mastra/README.md`](../../research/mastra/README.md), the verified Mastra findings.
- Root and `apps/api` / `packages/shared` `CLAUDE.md`, the repo conventions.
- [progress.md](progress.md), the spikes verified before planning and the decisions.
- Notion is linked in the root CLAUDE.md, if you can access it.

## Global Constraints

- **Repo conventions:**
  - Contracts go in `@tellia/shared`, never redefined in the API.
  - Validate requests with `zValidator` using the shared schemas.
  - Throw `HTTPException`, which the existing `onError` maps to the `ApiError` envelope.
  - Successful REST responses use the `{ data: ... }` envelope.
  - DB rows (snake_case) are mapped to camelCase at the module boundary.
  - Self-contained modules live under `src/modules/<name>/` and are mounted in `src/main.ts`.
  - Internal imports are extensionless (sloppy-imports).
  - Format with `deno fmt`: double quotes, semicolons, width 100.
- **The AI only runs the conversation; all numbers come from the calculation.** Tools return numbers. The agent's instructions forbid computing or guessing numbers.
- **No auth**, per the team decision. The chat identity is a farm **member**, taken from the `x-member-id` header and defaulting to the main contact (`member.main_contact = true`). An unknown member id returns 400.
  - Mastra memory resource = `member-{id}`; thread = `member-{id}-{YYYY-MM-DD}`.
  - These are set server-side through Mastra's reserved request-context keys, so ids sent in the request body are ignored.
- **Only `confirmed` irrigation operations count in the water balance.**
  - The assistant creates records as `status: draft`, which is what the `operation` table defines for unconfirmed records.
  - A draft becomes `confirmed` only when the **same member** resumes the suspended `record-irrigation` run with `confirmed: true`.
  - A declined draft is deleted.
- **UI tool contract:** the tool keys are `resolveField`, `getFarmAdvice`, `getFieldReport`, `simulateScenario`, `getWeather`, `recordIrrigation` and `confirmIrrigation`. They appear as `tool-<key>` message parts in the chat stream, so renaming one breaks the UI.
- **Hosting:** self-hosted Deno only, not Deno Deploy or edge isolates (Mastra issue #14503). Studio and `mastra dev` are Node-only and out of scope.
- **Language:** code, identifiers and engine "reason" sentences are in English. The agent replies in the member's language (`member.language`, `fr` for this farm).
- **Tests:**
  - No test may call an LLM, call Open-Meteo, or **write** to Supabase.
  - Use the in-memory `FarmData`, fake fetch and the scripted mock model.
  - An optional **read-only** Supabase integration test runs only when `RUN_DB_TESTS=1`.
  - Agents must never write to the shared Supabase DB.

## Review Focus

These failure modes are the most likely to hurt a real user. Each one is pinned by a test in the task named.

1. **Client-sent memory ids.** A chat request whose body claims another member's memory resource or thread must still use only the header member's thread. Covered in Task 12.
2. **Drafts must not count.** An unconfirmed (draft) irrigation must not change the advice. Declining deletes the draft. Confirming twice must not create a second record. Covered in Tasks 7 and 9.
3. **Resuming as someone else.** Resuming another member's `record-irrigation` run fails and confirms nothing. Covered in Task 9.
4. **Dates outside the crop season.** A timeline date with no growing crop on a field returns `outside_season`, and never sends an inverted date range to Open-Meteo. Covered in Tasks 6 and 7.
5. **First app open.** Chat history before any chat is an empty list, not a 500. Covered in Task 12.

---

## Real data this plan relies on (read on 2026-10-16)

- **Farm:**
  - One farm: "GAEC des Trois Chênes", FRB06, at 48.046 N, 1.794 E.
  - 4 members, all `fr`. Member 1, Claire Lefèvre, is the main contact.
- **Fields:** 11, two of them irrigable.

  | Field | Irrigable | Crop season | Status |
  |---|---|---|---|
  | **10 "La Vallée"** | yes | 109: MAIZ, sown 2026-04-16, harvest 2026-10-17, `irrigated: true` | growing |
  | **11 "Le Puits"** | yes | 121: COWT, sown 2026-10-09 | growing; MAIZ in 2026 is harvested |
  | 3 "Les Longues Raies" | no | RAPE | growing |

- **`crop_ref`:**
  - `gdd_base_c` is 6 for MAIZ and SUNF, and 0 for the winter crops.
  - Kc ini/mid/end, for example MAIZ 0.3 / 1.2 / 0.35.
- **`crop_stage`:** BBCH points with a `season_fraction` (share of sowing-to-harvest degree-days) and a `kc` at each point. The MAIZ points are:

  | fraction | 0 | .05 | .22 | .30 | .47 | .52 | .60 | .70 | .85 | .93 | 1 |
  |---|---|---|---|---|---|---|---|---|---|---|---|
  | kc | .30 | .30 | .37 | .66 | 1.2 | 1.2 | 1.2 | 1.2 | .86 | .59 | .35 |

- **`soil_analysis`:**
  - field 10: sand 63.5 %, clay 6.7 %, OM 5.11 %
  - field 11: sand 30.6 %, clay 28.3 %, OM 0.95 %
- **`weather_daily`:**
  - Daily data from 2015 to **2026-10-13**, with `et0_mm`, `precip_mm`, `tmin_c`, `tmean_c` and `gdd_base0/5/6/10`.
  - Up to 2024 it is AgERA5; from 2025 it is Open-Meteo. There are no future days.
- **`operation`:** 39 irrigation rows (`op_type: irrigation`, `water_mm`, `status: confirmed`, `source: import`). Field 10 has irrigations on 2026-06-21, 06-27 and 07-04, each 30.7 mm.
- **Default demo date:** `DEMO_DATE=2026-07-05`, which is maize mid-season, with real weather and real irrigations.

---

## File map (all new unless marked)

| Path | Responsibility | Task |
|---|---|---|
| `apps/api/deno.json` (modify) | Mastra deps pinned, `nodeModulesDir: auto`, extra permissions for LibSQL (ffi, write, sys), test task | 1 |
| `apps/api/.env.example` (modify), `packages/shared/src/env.ts` (modify) | add `MODEL`, `MASTRA_DB_URL`, `DEMO_DATE`, `TIMEZONE` | 1 |
| `packages/shared/src/irrigation.ts` + `index.ts`/`package.json` exports + api import map (modify) | all irrigation and chat contracts | 1 |
| `apps/api/src/modules/irrigation/data/farmData.ts` | the `FarmData` interface and its camelCase types | 1 (interface), 5 (Supabase implementation) |
| `apps/api/src/modules/irrigation/engine/util.ts` | dates and rounding | 1 |
| `…/engine/soil.ts`, `…/engine/crop.ts` | Saxton–Rawls soil water, root depth and p, Kc from stages, season fraction | 2 |
| `…/engine/waterBalance.ts`, `…/engine/report.ts` | daily depletion, decision and reason, ranking | 3 |
| `…/engine/scenario.ts` | what-if events | 4 |
| `…/data/memoryFarmData.ts`, `apps/api/tests/fixtures/farm.ts` | the in-memory `FarmData` and its realistic fixture | 5 |
| `…/weather/weatherService.ts`, `…/weather/openMeteo.ts` | DB history plus Open-Meteo gap and forecast, GDD, climatology, cache | 6 |
| `…/irrigation.service.ts` | the use cases | 7 |
| `…/irrigation.controller.ts`, `src/main.ts` (modify) | `/irrigation` REST | 8 |
| `apps/api/src/modules/chat/workflows/*.ts` | the four Mastra workflows | 9 |
| `…/chat/tools.ts` | the seven tools | 10 |
| `…/chat/advisor.agent.ts` | agent, instructions, memory | 11 |
| `…/chat/member.middleware.ts`, `…/chat/mastra.ts`, `…/chat/chat.routes.ts`, `src/main.ts` (modify) | member identity, Mastra instance, `/chat` and history, workers | 12 |
| `apps/api/tests/**` | tests; helpers: fixtures, fake fetch, scripted model, test app | all |
| `apps/api/CLAUDE.md` (modify), `apps/api/src/modules/chat/README.md`, `apps/api/scripts/smoke.ts` | docs, teammate contract, real-model smoke test | 13 |

---

## Task 1: Setup, shared contracts, FarmData interface, utils

**Build**
- **`apps/api/deno.json`:**
  - Add the Mastra packages, `ai` (for `ai/test`) and `@libsql/client` 0.18.0, all at exact versions, plus the subpath mappings `@mastra/core/`, `@mastra/ai-sdk/` and `ai/test`.
  - Add `"nodeModulesDir": "auto"`.
  - Add the import-map entry `@tellia/shared/irrigation`.
  - Give `dev`, `start` and `test` the extra permissions LibSQL needs (`--allow-ffi --allow-write --allow-sys`). Keep `--sloppy-imports` and the existing flags.
  - Make `check` type-check `src` and `tests`.
  - Run `deno install`, so `deno.lock` holds every new dependency. The lock file is committed.
- **Env:** extend the shared `ServerEnvSchema` with:
  - `MODEL` (default `openai/gpt-6.1-sol`, the main chat model) and `MODEL_MINI` (default `openai/gpt-6-luna`, for light helper work such as thread titles, if Mastra Memory supports it). Mastra's model router uses the existing `OPENAI_API_KEY` for both;
  - `MASTRA_DB_URL` (default `file:./data/mastra.db`);
  - `DEMO_DATE` (optional, `YYYY-MM-DD`);
  - `TIMEZONE` (default `Europe/Paris`).

  Document all four in `apps/api/.env.example`. Ignore `apps/api/data/` in git.
- **Contracts in `packages/shared/src/irrigation.ts`.** Export each schema and its inferred type, then export the module from the barrel, from `package.json` `exports` (`./irrigation`) and from the API import map.
  - `IsoDateSchema`.
  - `DecisionSchema`: `irrigate_today`, `frost_hold`, `wait_for_rain`, `no_irrigation`, `not_irrigable`, `outside_season`.
  - `FieldReportSchema`:
    - fieldId (int), fieldName, irrigable
    - cropCode (nullable), cropName (nullable), asOf
    - stageLabel (nullable), kc (nullable, 2 decimals)
    - decision, irrigateMm
    - depletionMm, tawMm, rawMm (1 decimal), depletionPct (integer)
    - daysUntilIrrigation (nullable), rainNext3DaysMm
    - reason, warnings (string list)
  - `DayBalanceSchema`: date, et0, kc, ks, etc, rain, irrigation, depletion, taw, raw.
  - `ScenarioEventSchema`, a discriminated union on `type`:
    - `irrigation`: date, mm > 0, max 200
    - `rain`: date, mm > 0, max 300
    - `drought`: date, days 1 to 30, et0Factor 1 to 2, default 1.3
    - `flood`: date, mm 50 to 400, default 120
    - `frost`: date, tmin ≤ 0, default −3
    - `hail`: date
  - `ScenarioComparisonSchema`: decisionChanged, mmBefore, mmAfter, summary.
  - `ScenarioResultSchema`: asOf, baseline, scenario, comparison, series of day balances.
  - `FarmAdviceSchema`: asOf, reports.
  - `WeatherDaySchema`: date, et0, rain, tmin, tmean, source (`db` or `open-meteo`).
  - `IrrigationRecordSchema`: operationId, fieldId, date, mm, status.
  - Request bodies:
    - `SimulateBodySchema`: events 1 to 10, optional date;
    - `RecordIrrigationBodySchema`: fieldId, date, mm > 0 and ≤ 200, optional memberId;
    - `AdviceQuerySchema`: optional date.
- **`FarmData` interface** (types only, in camelCase). Its methods:
  - `getFarm()` returns the location.
  - `listMembers()` and `getMember(id)`.
  - `listFields()` returns id, name, areaHa, irrigable and centroid.
  - `getSeasonAt(fieldId, date)` returns the crop season whose sowing ≤ date ≤ harvest, or null. A season has id, cropCode, sowingDate, harvestDate and status.
  - `getSoil(fieldId)` returns the latest analysis (sand, clay, organic matter %), or null.
  - `getCropRef(code)` returns names fr/en, gddBaseC and Kc ini/mid/end.
  - `getCropStages(code)` returns a list sorted by fraction.
  - `getWeather(from, to)` returns DB days with date, et0, rain, tmin, tmean and the gdd columns, as stored.
  - `getGddClimatology(base)` returns a map from "MM-DD" to the mean GDD over 2015–2024.
  - `listIrrigations(fieldId, { includeDrafts })`.
  - `createIrrigation({ fieldId, seasonId, date, mm, status, source, memberId })`.
  - `setIrrigationStatus(operationId, status)`.
  - `deleteIrrigation(operationId)`.
- **`engine/util.ts`:** `addDays`, `daysBetween` (ISO dates, computed in UTC), `todayIn(timeZone, now)`, `round1`, `round2`.

**Tests**
- `addDays` crosses month and year boundaries (06-30 + 1, 12-31 + 1, 03-01 − 1).
- `daysBetween(2026-04-16, 2026-07-05)` = 80, and the result can be negative.
- `todayIn`: 2026-07-04T23:30Z is 07-05 in Paris and 07-04 in UTC.
- `round1(156.00000000000003)` = 156.
- The shared contracts:
  - `ScenarioEventSchema` applies the flood, frost and drought defaults;
  - it rejects mm 0, an unknown type and a non-ISO date;
  - `RecordIrrigationBodySchema` rejects mm −5 and mm 250.
- The env schema accepts a missing `DEMO_DATE` and rejects "05/07/2026".

**Done when:**
- `deno task test` and `deno task check` pass in `apps/api`;
- `pnpm --filter @tellia/shared check-types` passes;
- the existing `/health` and `/data` routes still type-check.

Commit.

---

## Task 2: Engine, soil water and crop coefficients

**Build**
- **`soil.ts`:**
  - `soilWaterFromTexture({ sandPct, clayPct, organicMatterPct })` returns θFC and θWP, using the **Saxton & Rawls (2006)** equations at 33 kPa and 1500 kPa.
    - S and C are fractions and OM is a %. OM is clamped to 8 %, the valid range.
    - `θ1500t = −0.024S + 0.487C + 0.006OM + 0.005·S·OM − 0.013·C·OM + 0.068·S·C + 0.031`, then `θWP = θ1500t + (0.14·θ1500t − 0.02)`.
    - `θ33t = −0.251S + 0.195C + 0.011OM + 0.006·S·OM − 0.027·C·OM + 0.452·S·C + 0.299`, then `θFC = θ33t + (1.283·θ33t² − 0.374·θ33t − 0.015)`.
  - When there is no soil analysis, use a documented loam default (θFC 0.25, θWP 0.12).
  - `totalAvailableWater(θFC, θWP, rootDepthM)` = 1000 × (θFC − θWP) × root depth.
- **`crop.ts`:**
  - `cropWaterParams(cropCode)` returns root depth (m) and depletion fraction p, from FAO-56 Table 22. Values are kept in code because the DB has no such columns:

    | Code | Root depth | p |
    |---|---|---|
    | MAIZ | 1.2 | 0.55 |
    | COWT | 1.5 | 0.55 |
    | BARL | 1.2 | 0.55 |
    | RAPE | 1.2 | 0.60 |
    | SUNF | 1.0 | 0.45 |
    | anything else | 1.0 | 0.50 |

  - `kcAtFraction(stages, fraction)` interpolates linearly between `crop_stage` points. It returns the nearest stage label (the last stage reached), and null when the fraction is below 0 or above 1.
  - `kcFromRef(ref, fraction)` is the fallback when a crop has no stage rows. It uses the FAO four-segment curve over the season fraction:
    - initial: [0, 0.15), Kc ini;
    - development: [0.15, 0.40), linear from ini to mid;
    - mid-season: [0.40, 0.80), Kc mid;
    - late season: [0.80, 1], linear from mid to end.
  - `seasonFraction(gddSoFar, gddTotal)` is clamped to [0, 1], and is null if the total is ≤ 0.

**Tests**
- Saxton–Rawls. Field 10 texture gives θFC 0.2071 and θWP 0.0868 (±0.0005), so TAW at 1.2 m is 144.3 mm (±0.5). Field 11 gives 0.3188 and 0.1750, so TAW at 1.5 m is 215.8 mm (±0.5).
- An OM of 12 % gives the same result as 8 %.
- MAIZ `kcAtFraction`:
  - fraction 0.5 → 1.2, with the stage label of BBCH 55 (Tasselling);
  - 0.26 → 0.515;
  - 0.89 → 0.725;
  - 0 → 0.30;
  - 1 → 0.35;
  - −0.1 and 1.1 → null.
- `kcFromRef` with MAIZ ref (0.3 / 1.2 / 0.35):
  - 0.1 → 0.3;
  - 0.275 → 0.75;
  - 0.6 → 1.2;
  - 0.9 → 0.775.
- `seasonFraction(500, 1000)` = 0.5; (1200, 1000) → 1; (10, 0) → null.
- `cropWaterParams("XXXX")` returns the default.

**Done when:** these tests pass.

---

## Task 3: Engine, water balance, field report, ranking

**Build**
- **`runWaterBalance({ days, irrigations, taw, p, startDepletion? })`.** Each day carries date, et0, rain, tmin and kc, where kc is null outside the season. The function returns one `DayBalance` per day that has a kc.
  - Start at field capacity (depletion 0) or at the given start.
  - Ks = (TAW − previous depletion) / ((1 − p)·TAW) when the previous depletion > RAW, where RAW = p·TAW; otherwise Ks = 1.
  - ETc = Ks·Kc·ET0.
  - New depletion = previous − rain − irrigation + ETc, clamped to [0, TAW]. Excess water drains, and runoff is ignored.
  - Irrigations on the same date add up. Days are sorted first.
- **`buildFieldReport({ field, season, cropName, days, irrigations, taw, p, asOf, stageLabel, extraWarnings })`:**
  - The morning depletion is the balance at the end of `asOf − 1`.
  - The forecast window is `asOf` to `asOf + 6`. Forecast rain is summed over `asOf` to `asOf + 2`.
  - When tmin on `asOf` is below 0, the report adds the warning "Frost forecast today (min X °C)."
  - Decisions, in order:
    1. No season, or kc null on `asOf` → `outside_season`.
    2. Field not irrigable → `not_irrigable`: irrigateMm 0, same depletion numbers.
    3. Depletion ≥ RAW:
       - frost today → `frost_hold`, with mm = round(depletion);
       - else, forecast rain ≥ half the need → `wait_for_rain`, 0 mm;
       - else `irrigate_today`, with mm = round(depletion).
    4. Otherwise `no_irrigation`, where `daysUntilIrrigation` is the first projected forecast day, counted from 1, where depletion reaches RAW. Future irrigations count. It is null if that doesn't happen within 7 days.
  - **Reason sentences**, exact templates:
    - irrigate: "Root zone is {pct}% depleted ({dep} of {taw} mm), above the {p}% stress threshold, and only {rain} mm of rain is forecast in the next 3 days."
    - wait: "Root zone is {pct}% depleted, but {rain} mm of rain is forecast in the next 3 days, enough to cover most of the {need} mm need."
    - no irrigation: "Root zone is only {pct}% depleted ({dep} of {taw} mm), below the {p}% stress threshold; irrigation expected in about {n} days." Drop the clause after the semicolon when n is null.
    - frost: "Frost is forecast today (min {t} °C): irrigate {need} mm once temperatures are above 0 °C."
    - not irrigable: "Field is not irrigable; root zone is {pct}% depleted ({dep} of {taw} mm)."
    - outside the season: "No crop is growing on {fieldName} on {date}."
- **`rankReports`** sorts by decision (irrigate_today, frost_hold, wait_for_rain, no_irrigation, not_irrigable, outside_season), then by depletion % descending.

**Tests.** These use flat reference inputs, not real crop data, so the numbers are exact:
- kc 1.2 every day, ET0 5, no rain, tmin 12, from 2026-06-20 to 2026-07-12;
- TAW 156, p 0.55, so RAW is 85.8;
- an irrigable field 10 "La Vallée".

Water balance:
- 10 dry days → depletion 60, ETc 6, Ks 1.
- 20 mm of rain on day 3 and 30 mm of irrigation on day 5 → depletions [6, 12, 0, 6, 0].
- Day 16 → Ks = 66/70.2 and depletion = 90 + Ks·6. Day 15 ends at 90.
- Days with kc null are skipped.
- With ET0 at 50, depletion never exceeds TAW.

Report (`asOf` 07-05 unless stated):
- `irrigate_today` with 90 mm, depletion 90, TAW 156, RAW 85.8, 58 %, 0 mm rain, and the exact sentence.
- 50 mm of rain on 07-06 → `wait_for_rain`.
- `asOf` 06-30 → `no_irrigation`, depletion 60, 38 %, 5 days, and the exact sentence.
- 30 mm irrigated on 07-04 → `no_irrigation` with depletion 60.
- tmin −1 on 07-05 → `frost_hold` with 90 mm and the warning.
- The same field marked not irrigable → `not_irrigable`, 0 mm, depletion 90.
- No season → `outside_season`, with the sentence naming the field.
- `asOf` 06-20 → depletion 0, `daysUntilIrrigation` null, and the sentence without the clause.
- Ranking order holds across the decisions.

**Done when:** these tests pass.

---

## Task 4: Engine, what-if scenario events

**Build**
- `applyScenario(days, irrigations, events)` returns new days, new irrigations and warnings, and never mutates its inputs.
  - Rain and flood add rain on that day. A flood also warns: "Flood on {date}: soil saturated, do not irrigate until it drains."
  - Drought sets rain to 0 and multiplies ET0 by the factor (rounded to 1 decimal) for N days.
  - Frost lowers tmin.
  - Hail only warns: "Hail on {date}: check crop damage; this advice assumes an undamaged crop."
  - Irrigation is appended.
  - An event with no matching day warns: "Ignored {type} on {date}: no weather data for that date."
- `compareReports(baseline, scenario)` returns a `ScenarioComparison`. Its summary reads either:
  - "Scenario changes the decision from {a} ({x} mm) to {b} ({y} mm)."
  - "Scenario keeps {a}; irrigation {x} mm → {y} mm."

**Tests**
- Rain adds 25 mm to the right day and the input is unchanged.
- A flood with the default adds 120 mm and the warning.
- A 3-day drought on days with 2 mm of rain sets ET0 to 6.5 and rain to 0, and leaves day 4 untouched.
- Frost uses the −3 default, hail warns, and irrigation is appended.
- An event on 2027-01-01 gives the "Ignored" warning.
- Comparison: irrigate_today 90 vs wait_for_rain 0 → `decisionChanged` true, and the summary is exactly "Scenario changes the decision from irrigate_today (90 mm) to wait_for_rain (0 mm)."

**Done when:** these tests pass.

---

## Task 5: Data, Supabase FarmData and the in-memory twin

**Build**
- **`createSupabaseFarmData(db)`** implements `FarmData` on the existing service-role client:
  - Map snake_case rows to camelCase. Only these tables are touched: `farm`, `member`, `field`, `crop_season`, `soil_analysis`, `crop_ref`, `crop_stage`, `weather_daily`, `operation`.
  - **Paginate** every read that can exceed 1000 rows (weather, climatology) with `.range()` until it is exhausted.
  - Climatology: the mean of the requested `gdd_base{0|5|6|10}` per "MM-DD" over 2015-01-01 to 2024-12-31. Feb 29 folds into Feb 28. Cache it per base for the process lifetime.
  - `getSeasonAt` picks the crop season row that contains the date.
  - `listIrrigations` reads `operation` rows with `op_type = irrigation` and `water_mm` not null. Drafts are excluded unless asked for.
  - Writes:
    - `createIrrigation` inserts an `operation` with:
      - `op_type: irrigation`
      - `water_mm`
      - `status: draft` or `confirmed`
      - `source: assistant` (chat) or `app` (REST)
      - `origin: assistant`
      - `member_id`, `crop_season_id`
      - `area_ha` = the field area
    - `setIrrigationStatus` updates `status` and `updated_at`.
    - `deleteIrrigation` deletes the row.
  - A Supabase error becomes an `HTTPException(500)` with the message.
- **`createMemoryFarmData(fixture)`** implements the same interface in memory, including writes, for tests.
- **Fixture `tests/fixtures/farm.ts`**, mirroring the real data:
  - the farm location;
  - members 1 (main contact, fr) and 2;
  - fields 10 (irrigable), 11 (irrigable) and 3 (not irrigable);
  - seasons: 109 MAIZ on field 10, 2026-04-16 → 2026-10-17; 121 COWT on field 11, sown 2026-10-09; RAPE on field 3, 2025-08-24 → 2026-07-22;
  - real soil for fields 10 and 11, none for field 3;
  - crop_ref for MAIZ, COWT and RAPE;
  - the MAIZ crop_stage table above, and no stages for the others;
  - **constant weather** from 2026-04-01 to 2026-07-15: ET0 5, rain 0, tmin 12, tmean 20 (gdd_base0 20, gdd_base6 14);
  - a constant climatology with the same GDD values;
  - one confirmed irrigation of 30 mm on field 10 on 2026-06-21.
- **Optional integration test**, run only when `RUN_DB_TESTS=1`, **read-only**:
  - the farm exists;
  - field 10 is irrigable;
  - field 10's season at 2026-07-05 is MAIZ;
  - weather from 2026-07-01 to 07-03 has 3 days;
  - the climatology for base 6 has about 365 keys.

**Tests** (on the memory implementation)
- `getSeasonAt(10, 2026-07-05)` → MAIZ season 109. `getSeasonAt(10, 2026-12-01)` → null.
- `listIrrigations` excludes a draft by default and includes it on request.
- `createIrrigation`, then `setIrrigationStatus`, then `deleteIrrigation` behave as expected.
- Unknown member → undefined.
- Climatology lookup for "07-05" returns 14 for base 6.
- The mapping functions turn a sample snake_case `operation` row into the camelCase record. This is a pure function test of the Supabase mapper.

**Done when:** these tests pass. `RUN_DB_TESTS=1 deno task test` passes against the real DB, if a human runs it.

---

## Task 6: Weather service (DB history + Open-Meteo gap/forecast, GDD, climatology)

**Build**
- **`openMeteo.ts`:** a client for `https://historical-forecast-api.open-meteo.com/v1/forecast` (verified 2026-10-16: it serves 2021 through today + 14 days).
  - Daily variables: `et0_fao_evapotranspiration`, `precipitation_sum`, `temperature_2m_min`, `temperature_2m_mean`.
  - `timezone=auto`, an 8 s timeout, and zod-validated parsing.
  - Days with a null ET0 or temperature are dropped; a null rain becomes 0.
  - In-memory cache by rounded lat/lon and date range, 6 h TTL. Failures are not cached, and an error reads "Open-Meteo {status}: {body}".
- **`weatherService.getDailySeries({ from, to, gddBase })`** returns a merged, date-sorted list of days, each with et0, rain, tmin, tmean, gdd and source.
  - The DB serves `from` up to the last stored date.
  - Open-Meteo, at the farm location, fills the days after that, up to `to`.
  - GDD for Open-Meteo days = max(0, tmean − base). DB days use the stored `gdd_base{base}` column.
  - Never request an inverted range. Skip Open-Meteo when the DB covers the whole range.
- **`weatherService.seasonGddTotal({ sowing, harvest, gddBase, knownDays })`** sums the known GDD over sowing…harvest, plus the climatology for the days after the last known day.

**Tests** (fake fetch, memory FarmData)
- A range fully inside the DB gives 0 fetches, and every day's source is `db`.
- A range from 2026-07-14 to 2026-07-18, where the DB ends 07-15:
  - fetches once, with start_date 07-16 and end_date 07-18;
  - returns 5 days in order, with 07-16 to 07-18 marked `open-meteo` and GDD computed from tmean.
- A start after the end makes no fetch and returns an empty list.
- The URL contains the farm coordinates and `timezone=auto`.
- Cache hit, TTL expiry, and errors not cached.
- `seasonGddTotal` for MAIZ, sown 04-16 and harvested 10-17 (base 6, constant 14 per day), with known days through 07-15, equals 14 × 185 days.

**Done when:** these tests pass.

---

## Task 7: Irrigation service (the shared use cases)

**Build**
- `createIrrigationService({ data, weather, today })` provides:
  - `today()`
  - `resolveField(query)`: normalizes text (accents, case), then scores each field:
    - 100 for an exact name match;
    - 60 when the query and the name contain one another;
    - 40 for a crop name in fr or en, matched on the season at today;
    - otherwise 20 per shared word longer than 2 letters.

    It returns `{ fieldId, name, cropName }`, best first.
  - `getFieldReport(fieldId, asOf?)`.
  - `getFarmAdvice(asOf?)`, ranked over all fields.
  - `simulateScenario(fieldId, events, asOf?)`, which returns baseline, scenario, comparison, and a series from `asOf − 14` to `asOf + 6`.
  - `getWeather(fieldId, asOf?)`, covering `asOf ± 3`.
  - `previewIrrigation({ fieldId, date, mm })`, which validates and returns `{ fieldId, fieldName, date, mm, summary: "Record {mm} mm on {fieldName} for {date}?" }`.
  - `createDraftIrrigation({ fieldId, date, mm, memberId })`.
  - `confirmIrrigation(operationId)`, which is **idempotent**: an already confirmed record stays a single record.
  - `cancelIrrigation(operationId)`, which deletes a draft.
  - `recordIrrigation({ fieldId, date, mm, memberId, source })`, which creates a confirmed record directly. REST uses it.
  - `asOf` defaults to `today()`.
- **The report pipeline for one field at `asOf`:**
  1. Get the season at `asOf`. If there is none, return `outside_season` without fetching weather.
  2. Get the crop ref, stages, soil and crop water params; compute θ, TAW and p.
  3. Get the weather series from sowing to `asOf + 7`, with the crop's GDD base.
  4. For each day, compute the season fraction: cumulative GDD from sowing through that day, divided by `seasonGddTotal`. Then get Kc from the stages (or the ref fallback) and the stage label. Days after harvest have kc null.
  5. Get the confirmed irrigations.
  6. Call `buildFieldReport`.
- Validation errors (non-ISO date, mm ≤ 0 or > 200, date after today, unknown field, field without a season on that date) throw `HTTPException` 400 or 404 with a clear message.

**Tests** (memory FarmData, fixture, fake Open-Meteo returning no extra days, `today` = 2026-07-05)
- Farm advice ranks fields 10, 11 and 3:
  - field 11 → `outside_season` (wheat is only sown in October);
  - field 3 → `not_irrigable`;
  - field 10 → has a decision, its kc is between 1.0 and 1.2, and its stage label is not null.
- Field 10 at 2026-03-01 → `outside_season`, and no weather request has start > end.
- Recording 30 mm confirmed on 07-04 lowers field 10's `depletionMm` by exactly 30 (from the same `asOf`), or brings it to 0.
- **Drafts don't count:** a draft of 30 mm on 07-04 leaves the report unchanged. After `confirmIrrigation` the report changes. Calling `confirmIrrigation` again keeps exactly one confirmed record. `cancelIrrigation` on a draft removes it.
- Validation:
  - mm 0 and mm 250 → 400;
  - a future date → 400, with a message mentioning "future";
  - field 999 → 404;
  - field 11 on 07-04, which has no season → 400.
- The preview summary for 25 mm on field 10 on 07-04 is "Record 25 mm on La Vallée for 2026-07-04?".
- A scenario with 50 mm of rain tomorrow → comparison computed, and a series of 21 days.
- `resolveField`:
  - "la vallee" → 10;
  - "le puits" → 11;
  - "le maïs" → 10;
  - "xyz" → empty.

**Done when:** these tests pass.

---

## Task 8: REST module `/irrigation`

**Build**
- `irrigation.controller.ts` exports a factory that takes the service and returns a Hono router. Every route validates with the shared schemas and returns the `{ data }` envelope.
  - `GET /irrigation/advice?date=` → FarmAdvice.
  - `GET /irrigation/fields/:fieldId/report?date=` → FieldReport.
  - `GET /irrigation/fields/:fieldId/weather?date=` → weather days.
  - `POST /irrigation/fields/:fieldId/simulate` with `SimulateBody` → ScenarioResult.
  - `POST /irrigation/operations` with `RecordIrrigationBody` → 201 with a confirmed IrrigationRecord (source `app`; the member defaults to the main contact).
  - `GET /irrigation/operations?fieldId=` → the confirmed irrigation records.
- Mount it in `main.ts`, with the real service built from Supabase FarmData, the weather service and `today` (= `DEMO_DATE`, or the date in `TIMEZONE`).
- Add a test-app helper that builds the same router on the memory FarmData.
- This is the **fast path** the VAPI teammate's tool webhooks should call: no LLM, no workflow.

**Tests** (`app.request` on the test app)
- Advice → 200 with `data.reports` of length 3.
- Report for field 999 → 404 with the `ApiError` envelope.
- Simulate with a 5-day drought → 200 with a non-empty series.
- Simulate with `events: []` → 400.
- Operations POST with mm −5 → 400. A valid one → 201. Malformed JSON → 400.

**Done when:**
- the tests pass;
- `deno task check` passes;
- `deno task start` serves `/irrigation/advice` with real data. A human, or the stage agent, runs it read-only: one GET with no writes. It needs network and Supabase.

---

## Task 9: Mastra workflows

**Why:** "Full Mastra". Workflows give:
- durable confirmations that survive between messages, and later voice turns;
- a fan-out over fields;
- a scheduled morning job;
- a step-by-step trace of each run.

Steps call the irrigation service, never the FAO maths directly.

**Build**
- `createAdvisorWorkflows(service, data)` returns four committed workflows.
- **`farm-advice`.** Input: optional asOf.
  1. A **list-fields** step resolves asOf.
  2. **`.foreach`** runs a field-report step, concurrency 4.
  3. A **rank** step outputs a FarmAdvice.
- **`simulate-scenario`.** Input: fieldId, events, optional asOf.
  1. A **simulate** step returns the ScenarioResult, which includes the comparison.
  2. A **summarize** step passes it through with the comparison summary.
- **`record-irrigation`.** Input: memberId, fieldId, date, mm.
  1. A **validate** step calls `previewIrrigation`. An error fails the run.
  2. A **draft** step calls `createDraftIrrigation` and outputs the operationId.
  3. A **confirm** step:
     - **suspends** with the payload `{ summary, operationId, fieldId, fieldName, date, mm }`, resume schema `{ confirmed: boolean }`;
     - on resume, **rejects** unless the resuming request context's `memberId` equals the input memberId.
  4. A **finish** step:
     - when confirmed, calls `confirmIrrigation` and outputs `{ status: "saved", record }`;
     - otherwise calls `cancelIrrigation` and outputs `{ status: "cancelled" }`.
- **`morning-warmup`.** Input: empty.
  1. A step computes farm advice for today. This fills the Open-Meteo and climatology caches before calls (the product plan's "heavy calculations before the call").
  2. It outputs `{ fields, irrigateToday, failures }`.
  - Schedule: cron `0 5 * * *`, timezone Europe/Paris. Schedule id `wf_morning-warmup`.
- Verified on Deno with core 1.78.0 (spike, 2026-10-16):
  - start → `suspended`, with `runId` and `suspendPayload` keyed by step id;
  - a fresh `createRun({ runId })`, then `resume({ step, resumeData, requestContext })` works, and later steps see the resuming request context;
  - `.foreach` returns an array, and `.parallel` returns an object keyed by step id;
  - a tool's execute context has `mastra`.
- **Test helper `makeTestMastra({ service, data, model? })`:** a Mastra instance with these workflows (and the agent from Task 11, when a model is given) on a temp-file LibSQL store.

**Tests**
- **farm-advice** → success, with the same three reports and order as the service.
- **simulate-scenario** with 50 mm of rain on 07-06 → the comparison is present.
- **record-irrigation:**
  - Start as member 1, 25 mm on field 10 on 07-04 → suspended, with summary "Record 25 mm on La Vallée for 2026-07-04?". One **draft** exists, and the advice is unchanged.
  - Resume from a **fresh** run handle with confirmed true as member 1 → saved; the record is confirmed and the advice changes.
  - Resume with confirmed false → cancelled, and the draft is deleted.
  - Resume as member 2 → fails or rejects, and the draft stays a draft.
  - Resume the same confirmed run a second time → still exactly one confirmed record.
  - A future date → fails at validate, never suspends, and no draft is created.
- **morning-warmup** → success with fields 3 and failures 0.

**Done when:** these tests pass.

---

## Task 10: Mastra tools

**Build**
- `memberIdFrom(ctx)` reads `memberId` from the tool's request context and throws if it is missing.
- `createAdvisorTools(service)` returns seven tools. Each has zod input and output schemas taken from `@tellia/shared/irrigation`, and a description written for the model.

  | Key (UI contract) | Tool id | Input → behavior |
  |---|---|---|
  | `resolveField` | `resolve_field` | query → matches |
  | `getFieldReport` | `get_field_report` | fieldId, optional date → service |
  | `getWeather` | `get_weather` | fieldId, optional date → service |
  | `getFarmAdvice` | `get_farm_advice` | optional date → `farm-advice` workflow |
  | `simulateScenario` | `simulate_scenario` | fieldId, 1 to 10 events, optional date → `simulate-scenario` workflow |
  | `recordIrrigation` | `record_irrigation` | fieldId, date, mm → starts `record-irrigation` with the caller's memberId, returns `{ runId, status: "awaiting_confirmation", summary, fieldName, date, mm }`. Description: "ask the farmer this summary as a yes/no question". |
  | `confirmIrrigation` | `confirm_irrigation` | runId, confirmed → resumes the run with the caller's request context, returns `{ status: "saved" \| "cancelled", record? }`. Description: "only with the farmer's explicit answer". |

- Workflow-backed tools get Mastra from `ctx.mastra` and pass the request context through. A run that doesn't succeed becomes a thrown error carrying its message.
- Verified: an error thrown inside a tool reaches a direct caller, and invalid input returns `{ error: true, message }`.

**Tests** (call `execute` directly, with a context holding a request context with memberId **and** the test Mastra)
- The tool keys are exactly the seven above.
- `resolveField` "la vallée" → field 10 first.
- `getFieldReport` 10 → a report. Field 999 → rejects. No memberId → rejects.
- `getFarmAdvice` → 3 reports.
- `simulateScenario` → a comparison. With `events: []` → an error object.
- `recordIrrigation` → awaiting_confirmation with a runId and a draft. Then `confirmIrrigation(runId, true)` → saved.
- `confirmIrrigation` from member 2 on member 1's run → rejects, and nothing is confirmed.

**Done when:** these tests pass.

---

## Task 11: Advisor agent

**Build**
- `ADVISOR_ID` = `advisor`.
- `buildInstructions(service, data, memberId)`:
  - **Unknown member:** say the user is unknown, do not call tools, and ask them to reopen the app.
  - **Known member:**
    - who they are, the farm name and today's date;
    - the default language;
    - the farm's fields with the crop growing today, as "- {name} (field {id}, {crop or "no crop"}, {area} ha, irrigable yes/no)";
    - the rules below.

    **Rules:**
    1. Never compute or guess numbers. Copy every number from a tool result.
    2. Which tool to use: farm advice for "what should I water", the field report for a single field, weather for weather questions.
    3. Reply in the member's language, briefly: the decision and mm first, then the tool's reason, translated with the numbers unchanged.
    4. When the farmer reports watering:
       - resolve the field;
       - call recordIrrigation;
       - ask the returned summary as a yes/no question;
       - on a clear answer, call confirmIrrigation with that runId.
       - Never call confirmIrrigation without an explicit answer. If they give minutes instead of mm, ask for mm first.
    5. Questions about drought, rain, flood, frost, hail, or "what if I water…" go to simulateScenario; use its comparison summary.
    6. If the field is ambiguous, resolve it and ask. Never invent a field. If a tool fails, say so briefly.
    7. Mention any warnings the tools return.
- `createAdvisorAgent({ service, data, model })`:
  - Dynamic instructions that read `memberId` from the request context.
  - The seven tools.
  - Mastra Memory with the last 20 messages and working memory in **template** mode: language, field nicknames, preferences. Template mode is the one verified on Deno.
  - The model is the `MODEL` router string (`openai/gpt-6.1-sol`), or the scripted mock in tests. `MODEL_MINI` (`openai/gpt-6-luna`) is wired through `createMastra` for light helper work.
- **Test helper `scriptedModel(steps)`:** a `MockLanguageModelV3` from `ai/test` that serves both generate and stream. Each call consumes the next step, either some tool calls or a text. It records the prompts, and answers "OK." once the script runs out.

**Tests**
- The instructions for member 1 contain:
  - "Claire Lefèvre"
  - "GAEC des Trois Chênes"
  - "La Vallée (field 10, Maïs grain" or the English crop name, whichever language you chose
  - "Today is 2026-07-05"
  - "Never compute or guess numbers"
  - "confirmIrrigation"
- The instructions for an unknown member say the user is unknown.
- **Agent run.** The script calls getFarmAdvice, then returns the text "Arrosez La Vallée : 90 mm.". Generating with memberId 1:
  - returns that text;
  - the farm advice ran (spy on the service);
  - the first prompt contained "Claire Lefèvre".
- **Two-turn confirmation.** Turn 1 calls recordIrrigation → one draft. Turn 2 calls confirmIrrigation with turn 1's runId → the draft is confirmed. Read the runId from the tool result in the prompt, or call the tool's execute directly for turn 2, whichever the mock allows.

**Done when:** these tests pass.

---

## Task 12: Chat module, Mastra on the app, member identity, history, workers

**Build**
- **`member.middleware.ts`**, a Mastra `server.middleware` for `/chat*` and `/api/*`:
  - It passes OPTIONS through.
  - It reads `x-member-id`. A missing header means the main contact; an unknown id returns 400 with the `ApiError` envelope.
  - It sets Mastra's reserved resource id key to `member-{id}`, the reserved thread id key to `member-{id}-{today}`, and `memberId`.

  Because these keys are reserved, Mastra ignores memory ids sent in the body. This was verified in a spike.
- **`mastra.ts`**, `createMastra({ service, data, model, storageUrl })`:
  - the agent
  - the four workflows
  - LibSQL storage
  - `chatRoute` at `/chat` for the fixed advisor agent, with `version: "v7"` and max 6 steps
  - the middleware
- **`chat.routes.ts`**, `GET /chat/history`:
  - It resolves the member itself, because it is registered before Mastra.
  - It finds today's thread. If the thread is missing or belongs to another resource, it returns `{ data: { threadId, messages: [] } }`.
  - Otherwise it recalls the messages and converts them to AI SDK v7 UI messages (verified API).
- **`main.ts`:**
  - Build the Mastra instance and mount `/chat/history`.
  - Initialize Mastra's Hono server on the same app, which adds `/chat` and `/api/*`.
  - Make sure `./data` exists.
  - Call `mastra.startWorkers()` after `Deno.serve`, or the 05:00 schedule never fires.
  - Keep the existing CORS. It must allow the `x-member-id` header.
- **Test app helper:** the full app on the memory FarmData, the scripted model and a temp LibSQL store.

**Tests**
- A CORS preflight on `/chat` allows the `x-member-id` and content-type headers.
- `POST /chat` with an unknown member → 400.
- **Chat ignores client-supplied memory ids.** Send a chat as member 1, whose body claims `member-2`'s resource and a "stolen" thread:
  - The response is a 200 event stream.
  - The stream contains a tool-output part for the farm advice, with field 10, and the scripted text.
  - Memory then has exactly one thread for `member-1` (`member-1-2026-07-05`) and none for `member-2`.
- No header → treated as member 1.
- **History is empty before the first chat.** It is first an empty list. After one chat it has 2 messages, the second with a `tool-getFarmAdvice` part.
- After `startWorkers()`, `GET /api/schedules` lists `wf_morning-warmup`. If this Mastra version uses another route, assert on that and note it in progress.md.

**Fallbacks** (record in progress.md if used):
- If Mastra's middleware type clashes with the app's Hono types, cast at the call site.
- If a memory "get thread by id" call is unavailable, list threads filtered by resource, which was verified.

**Done when:** the full suite and `deno task check` pass, and `deno task start` boots with `/health`, `/irrigation/advice` and `/chat` responding.

---

## Task 13: Docs, smoke test, latency

**Build**
- **`apps/api/scripts/smoke.ts`:**
  - Posts a question to `/chat` with `x-member-id: 1`.
  - Parses the SSE stream with a line buffer and prints each tool call with its time.
  - Prints the text, then the time to first byte, first text and total.
  - Add a `smoke` task.
- **`apps/api/src/modules/chat/README.md`**, the teammate contract:
  - **Chat in the web app:**
    - Load `/chat/history` first.
    - Use `useChat` with `DefaultChatTransport` pointing at `/chat`, with the `x-member-id` header, sending only the newest message.
    - Render each tool part as a card: skeleton while the input is available, card when the output is available, error card on an error. This includes the `tool-recordIrrigation` confirmation card with Oui/Non buttons that send that text.
    - Say that the numbers on screen come from the cards.
  - **The `/irrigation` REST endpoints:** VAPI webhooks should call `/irrigation/advice`, not `/chat`, to stay under 2 s.
  - **The four workflows** and what each does.
  - **The engine method** and its simplifications: constant root depth per crop, no runoff, field capacity at sowing, GDD season fraction with climatology for the days still to come.
- **`apps/api/CLAUDE.md`:** add the irrigation and chat modules to the layout, the `MODEL` env, and the "only confirmed irrigations count" rule.

**Manual check.** It uses the real `OPENAI_API_KEY` and makes **no DB writes**. Run `deno task start`, then smoke with:
1. "Quel champ dois-je arroser aujourd'hui ?" → getFarmAdvice, then a French answer whose mm matches the tool output.
2. "Et si une sécheresse de 5 jours commence aujourd'hui sur La Vallée ?" → simulateScenario.

Do **not** smoke the record/confirm flow, because it writes to the shared DB. Leave it for a human. Write the timings into progress.md.

**Done when:** the docs are committed and the latency is recorded.

---

## Task 14: Live end-to-end tests (real LLM, real data read-only)

**Why:** the user wants proof that the whole thing works, including real model calls. The `OPENAI_API_KEY` in `apps/api/.env` may be used.

**Build**
- A separate live suite, `apps/api/tests/live/*_test.ts`, run with a new `test:live` task.
  - The task loads `.env` and sets `RUN_LIVE_TESTS=1`.
  - Every live test is skipped unless that variable is set, so `deno task test` stays offline and free.
- **The live app:**
  - The full app from Task 12, with the **real model** (`MODEL`, default `openai/gpt-6.1-sol`) and the in-memory `FarmData` fixture.
  - The fixture means the chat can create and confirm irrigation records without touching Supabase.
  - Weather comes from the fixture, so Open-Meteo is not needed.
  - The temp LibSQL store is used for memory and workflow snapshots.
- **One helper** posts a chat turn and parses the v7 SSE stream into `{ toolCalls: [{ name, input, output }], text, msFirstText, msTotal }`.

**Tests.** Assertions are on tool behavior and numbers, never on exact wording.
1. **Advice.** Ask "Quel champ dois-je arroser aujourd'hui ?".
   - getFarmAdvice is called.
   - The reply is non-empty.
   - Every "N mm" in the reply text equals an `irrigateMm`, `depletionMm` or `rainNext3DaysMm` value from the tool output, to ±0.5. This is the mm-grounded check.
   - The reply mentions "La Vallée".
2. **Scenario.** Ask "Et si une sécheresse de 5 jours commence aujourd'hui sur La Vallée ?".
   - simulateScenario is called with fieldId 10 and a `drought` event.
   - The reply is non-empty.
3. **Two-turn confirmation**, both turns in the same member thread.
   - Turn 1: "J'ai arrosé La Vallée hier, 25 mm". recordIrrigation is called with fieldId 10, mm 25 and yesterday's date. confirmIrrigation is **not** called. Exactly one draft exists, and the reply asks a question.
   - Turn 2: "oui". confirmIrrigation is called with confirmed true. The fixture now holds a confirmed 25 mm record, and the field report's depletion went down.
4. **Memory.** After test 3, a new question in the same thread ("Et pour Le Puits ?") gets an answer without error. Chat history has at least 4 messages.
5. **Latency.** Record `msFirstText` and `msTotal` for test 1 and write them to progress.md (Latency table). Don't assert under 2 s; chat isn't the voice path.
6. **Real data, read-only.** Only when `RUN_DB_TESTS=1` too: GET `/irrigation/advice?date=2026-07-05` against the real Supabase FarmData returns a report for field 10, with crop MAIZ and a stage label.

**Done when:** `deno task test:live` passes twice in a row, the latency is recorded, and the offline suite is still green. Live tests may make about 10 model calls per run.

---

## Self-review

- **Coverage of the product plan's backend list:**

  | Product plan item | Covered in |
  |---|---|
  | Chat (Full Mastra) | Tasks 9 to 12 |
  | Get Weather | Tasks 6 and 10 |
  | Advice endpoint | Tasks 7 and 8 |
  | resolve / report / simulate | Tasks 7 and 10 |
  | Edge cases (drought, flood, frost, hail) and moving the timeline | Task 4, plus the `date` parameter everywhere |
  | Farmer-reported watering, kept as confirmed operations | Tasks 5, 7 and 9 |
  | One-sentence reason | Task 3 |
  | Degree days | Tasks 2 and 6 |
  | Precompute before calls | `morning-warmup` |

- **Out of scope:**
  - the VAPI webhook, Twilio, SMS and WhatsApp (separate owner);
  - the web UI cards (Marceau);
  - writing morning `alert` rows (backlog; confirm the table's owner first).
- **Names used consistently across tasks:**
  - the seven tool keys
  - the four workflow ids
  - `ADVISOR_ID`
  - memory ids `member-{id}` and `member-{id}-{date}`
  - `TEST_TODAY` 2026-07-05
  - fixture fields 10, 11 and 3, and season 109
  - flat-reference numbers 156, 85.8, 90, 60, 58 % and 38 %
  - real-soil numbers TAW 144.3 (field 10) and 215.8 (field 11)
