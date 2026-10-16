# Chat & irrigation advisor: progress log

Plan: [plan.md](plan.md) · Checklist: [todo.md](todo.md) · Research: [../../research/mastra/README.md](../../research/mastra/README.md)

Owner: Mastra / chat part. Branch: `feat/chat-backend`. Code goes in `apps/api` (modules `irrigation` and `chat`), and contracts go in `packages/shared/src/irrigation.ts`.

## Status

| # | Task | Status | Date | Notes |
|---|---|---|---|---|
| 0 | Research, verification spikes, real-data check | ✅ done | 2026-10-16 | see below |
| 1 | Setup, shared contracts, FarmData interface, utils | ✅ done | 2026-10-16 | deps pinned + locked, env vars, `@tellia/shared/irrigation`, `FarmData` types, `engine/util.ts`; 8 tests |
| 2 | Engine: soil water (Saxton–Rawls), crop Kc, season fraction | ✅ done | 2026-10-16 | 7854e9b; review clean |
| 3 | Engine: water balance, field report, ranking | ✅ done | 2026-10-16 | e6b880d; review clean |
| 4 | Engine: scenario events + comparison | ✅ done | 2026-10-16 | 051b837; events with no weather day (including irrigation) are ignored with a warning |
| 5 | Data: Supabase FarmData + in-memory twin + fixture | 🟡 re-review | 2026-10-16 | 2582776 + fix 9556cf8 (status/delete scoped to irrigation ops, 404). Read-only DB test passed. Write path not yet run against the DB |
| 6 | Weather service: DB + Open-Meteo gap/forecast, GDD, climatology | ✅ done | 2026-10-16 | 8830372 + 332adbf (stored-GDD test, Feb 29 fallback) |
| 7 | Irrigation service (use cases) | ✅ done | 2026-10-16 | `irrigation.service.ts`, 11 tests; adds `listIrrigations`, `defaultMemberId`; cancel only deletes drafts (409 otherwise) |
| 8 | REST `/irrigation` | ✅ done | 2026-10-16 | controller + test app helper, 6 REST tests; real server advice 200 in ~2 s (11 fields, cold) |
| 9 | Mastra workflows (farm-advice, simulate-scenario, record-irrigation, morning-warmup) | ✅ done | 2026-10-16 | `chat/workflows/index.ts`, 10 tests; weather TTL cache (10 min) so the warmup warms later calls; capped frost_hold wording fixed; schedule `0 5 * * *` Europe/Paris |
| 10 | Mastra tools (8) | ✅ done | 2026-10-16 | `chat/tools.ts`, 12 tests; memberId only from request context; foreign confirm refused before resume, run stays suspended |
| 11 | Advisor agent | ✅ done | 2026-10-16 | `chat/advisor.agent.ts`, `tests/helpers/scriptedModel.ts`, 4 tests; Memory lastMessages 20 + resource-scope template working memory; MODEL_MINI wired as `generateTitle.model` |
| 12 | Chat module: `/chat`, member identity, history, workers | ✅ done | 2026-10-16 | `chat/{member.middleware,mastra,chat.routes}.ts`, `main.ts`, 6 tests; real chat verified on port 8125 (getFarmAdvice + French text, ttfb 1.3 s, total 12.7 s) |
| 13 | Docs, smoke test, latency | ⬜ todo | | |
| 14 | Live end-to-end tests (real LLM, real data read-only) | ⬜ todo | | |

Legend: ⬜ todo · 🟡 in progress · ✅ done · ⛔ blocked

## Verified before planning (2026-10-16)

The spikes ran on Deno 2.7.7 with `@mastra/core` 1.78.0 and mock models. Their code is in the session scratchpad and is not committed.
- **Mastra runtime:** Agent, tool, Memory (LibSQL file), workflow and `@mastra/hono` on `Deno.serve` all work. `startWorkers()` registers the cron schedule.
- **Chat route:** `chatRoute({ path, version: "v7" })` streams `tool-input-available` and `tool-output-available` parts. It is mounted at the given path, with **no** `/api` prefix.
- **Middleware:** Mastra `server.middleware` can short-circuit with 401 or 400, and has `c.get("requestContext")`.
- **Memory ids:** the reserved `MASTRA_RESOURCE_ID_KEY` and `MASTRA_THREAD_ID_KEY` override any `memory` sent in the body; a fake "ATTACKER" resource was ignored.
- **History:** sending only the newest message keeps a clean thread. `memory.recall` plus `toAISdkMessages(msgs, { version: "v7" })` gives UI messages with `tool-<key>` parts. `memory.listThreads({ filter: { resourceId } })` works.
- **Tools:** an error thrown in `execute` propagates, and invalid input returns `{ error: true, message }`. The tool context has `mastra`.
- **Workflows:**
  - Start returns `suspended` with a `runId` and a `suspendPayload` keyed by step.
  - A fresh `createRun({ runId }).resume({ step, resumeData, requestContext })` succeeds, and later steps see the resuming context.
  - `.foreach` returns an array; `.parallel` returns an object keyed by step.
- **Model router:** knows `openai/gpt-5-mini`, `anthropic/claude-haiku-5-5` and others. The repo has `OPENAI_API_KEY`.
- **Open-Meteo:** the forecast endpoint rejects dates older than about 3 months. The historical-forecast endpoint serves 2021 to today + 14 days, with `timezone=auto`.
- **Supabase data**, read only:
  - 1 farm (FRB06, 48.05 N, 1.79 E) with 4 `fr` members; member 1 is the main contact.
  - 11 fields. Two are irrigable: 10 La Vallée, with MAIZ sown 2026-04-16 and harvested 2026-10-17, and 11 Le Puits, with COWT sown 2026-10-09.
  - `crop_stage` holds Kc per BBCH point against the GDD season fraction.
  - `weather_daily` runs from 2015 to 2026-10-13.
  - `operation` has 39 irrigation rows. Its `status` values are confirmed and planned, its `source` is import, and its `origin` is dataset_adjusted or generated. The `alert` and `message` tables are empty.
- **Saxton–Rawls reference:**
  - field 10: θFC 0.2071, θWP 0.0868, TAW 144.3 mm at 1.2 m
  - field 11: θFC 0.3188, θWP 0.1750, TAW 215.8 mm at 1.5 m

## Decisions

| Date | Decision | Why |
|---|---|---|
| 2026-10-16 | Build inside `apps/api` as the modules `irrigation` and `chat`, with contracts in `@tellia/shared` | The team scaffolded a monorepo with these conventions |
| 2026-10-16 | Data comes from Supabase behind a `FarmData` interface, with an in-memory twin for tests | Real farm, crop, stage, soil, weather and irrigation data already exists; tests must not touch the shared DB |
| 2026-10-16 | Identity is `x-member-id`, defaulting to the main contact. Memory is `member-{id}`, thread `member-{id}-{date}` | Team decision: no auth. The reserved keys still keep members' memory apart |
| 2026-10-16 | Kc comes from `crop_stage` by GDD season fraction, using climatology for future days, with the `crop_ref` 4-segment curve as fallback | It matches the DB's documented stage model and the plan's "Degree day" item |
| 2026-10-16 | Soil water comes from Saxton–Rawls applied to `soil_analysis` texture and OM | Uses the real per-field data; FAO Table 19 lacks some textures, such as clay loam |
| 2026-10-16 | The assistant writes `operation` rows as `status: draft`, and confirms them by resuming a suspended `record-irrigation` workflow. Only confirmed rows count | The `operation` table defines "draft" this way; suspend/resume is verified |
| 2026-10-16 | Use Mastra workflows: farm-advice, simulate-scenario, record-irrigation and morning-warmup | User's choice; durable confirmations and step traces |
| 2026-10-16 | The REST `/irrigation` module is the fast path for VAPI, with no LLM and no workflow | The 2 s call budget |
| 2026-10-16 | Models: `MODEL=openai/gpt-6.1-sol` (main) and `MODEL_MINI=openai/gpt-6-luna` (mini tasks). Both are in Mastra 1.78's model router under the openai provider | User's choice; the repo already has an OpenAI key |
| 2026-10-16 | `DEMO_DATE=2026-07-05` | Maize mid-season, with real weather and irrigations; today is near harvest |
| 2026-10-16 | Build with the Workflow tool using Sonnet agents, on branch `feat/chat-backend` (root CLAUDE.md says to work on main; we merge when it's done) | User's choice; earlier instruction to use only Sonnet for sub-agents |
| 2026-10-16 | The plan contains no code | User's instruction |
| 2026-10-16 | Test files are `apps/api/tests/*_test.ts`, run by `deno task test` (the shared package has no tests; vitest unused). Keep util/contract tests pure: never import `src/config.ts` without setting env first | `deno test` only picks up `*_test.ts`; config parses env at import |
| 2026-10-16 | Lock resolves a single zod (4.6.7, required by Mastra). The lock's `@hono/zod-validator` peer was hand-edited from zod 4.4.3 to 4.6.7 so `deno task check` passes (two zod copies broke `zValidator` types). Re-run `deno install` after any dep change and confirm `grep "zod@4.4.3" apps/api/deno.lock` is empty | Duplicate zod versions are type-incompatible |
| 2026-10-16 | `confirm_irrigation` loads the run (`getWorkflowRunById`) and refuses a foreign member, an unknown runId or a non-suspended run BEFORE resuming, so the run stays suspended and the owner can still answer. The in-step memberId check stays as defense in depth (a direct wrong-member resume still fails the run) | Fix round 1: a foreign attempt must not orphan the draft |
| 2026-10-16 | `morning-warmup` computes per-field reports (allSettled) so failures are counted; the weather service caches series and season totals for 10 min | Lets one bad field not hide the others; fills the cache for later advice calls |
| 2026-10-16 | Mastra `server.cors: false`: the app's own Hono CORS (allowing `x-member-id`) is registered first and handles preflights. `GET /api/schedules` lists `wf_morning-warmup` after `startWorkers()`. `generateTitle.model` takes `MODEL_MINI` | Mastra's default CORS would not allow `x-member-id` |
| 2026-10-16 | `check` now type-checks `src/main.ts tests/`; hono floor not bumped (resolves 4.13.13) | Mastra did not need a newer hono |

## Open questions

- Is there a compute spec in Notion for irrigation (the link is in the root CLAUDE.md)? Our method may need to line up with it.
- Who owns the `alert` table ("3 actions of the day")? The morning job could write irrigation alerts once that's agreed.
- Is Mastra memory and workflow storage in a local LibSQL file fine for the demo, or should it move to Supabase Postgres (`@mastra/pg`, untested on Deno)?

## Latency

Filled in by Task 13. The target is first text under 2 s for chat; voice uses `/irrigation`, which has no LLM.

| Date | Question | First byte | First text | Total | Model |
|---|---|---|---|---|---|

## Log

- 2026-10-16: research and spikes done; the plan was adapted to the monorepo and the real Supabase data.
- 2026-10-16: Tasks 1-6 implemented by Sonnet subagents (2-4, 5 and 6 in parallel), each reviewed. Suite: 51 passed, 1 ignored (the opt-in DB test). Added Task 14 (live LLM tests) and the gpt-6.1-sol / gpt-6-luna models at the user's request.
- 2026-10-16: the operation schema (PostgREST OpenAPI) shows status/source/origin as text with defaults confirmed/import/agent and no enum. Draft rows are likely accepted; CHECK constraints are not visible, so a human verifies one insert.
- 2026-10-16: Task 1 done (setup, contracts, FarmData interface, util).
