# Chat backend: progress log

Plan: [plan.md](plan.md) · Checklist: [todo.md](todo.md) · Research: [../../research/mastra/README.md](../../research/mastra/README.md)

Owner: Mastra / chat part. Branch: `feat/chat-backend`. Code lives in `backend/`.

## Status

| # | Task | Status | Date | Notes |
|---|---|---|---|---|
| 0 | Research + verification spikes | ✅ done | 2026-10-16 | see "Verified before planning" |
| 1 | Scaffold Deno backend (config, utils) | ⬜ todo | | |
| 2 | FAO-56 tables + Kc curve | ⬜ todo | | |
| 3 | Water balance, report, ranking | ⬜ todo | | |
| 4 | Scenario events (drought/flood/frost/hail) | ⬜ todo | | |
| 5 | Open-Meteo provider + cache | ⬜ todo | | |
| 6 | Farm data: seed, resolver, irrigation store | ⬜ todo | | |
| 7 | Advisor services | ⬜ todo | | |
| 8 | Mastra workflows: farm-advice, simulate-scenario, record-irrigation (suspend/resume), morning-warmup | ⬜ todo | | |
| 9 | Mastra tools (7, direct or workflow-backed) | ⬜ todo | | |
| 10 | Advisor agent | ⬜ todo | | |
| 11 | HTTP app: /chat, auth, CORS, history, /v1, schedule, main | ⬜ todo | | |
| 12 | Real-model smoke + API contract README | ⬜ todo | | |

Legend: ⬜ todo · 🟡 in progress · ✅ done · ⛔ blocked

## Verified before planning (2026-10-16)

All on Deno 2.7.7 with `@mastra/core` 1.78.0, using mock models. Spike code is in the session scratchpad and is not committed.

- **Runtime:** Agent, tool, Memory on a LibSQL file, workflow, and `@mastra/hono` on `Deno.serve` all work. `mastra.startWorkers()` registers the cron schedule (research file 01).
- **Chat endpoint:** `chatRoute({ path, version: 'v7' })` from `@mastra/ai-sdk` 1.11.1 streams SSE with `tool-input-available` and `tool-output-available` parts. It is mounted at the path given, with **no** `/api` prefix.
- **Middleware:** Mastra `server.middleware` can return 401, and `c.get('requestContext')` is available inside it. Setting `MASTRA_RESOURCE_ID_KEY` and `MASTRA_THREAD_ID_KEY` there **overrides** any `memory` the client puts in the body: a fake `ATTACKER` resource was ignored.
- **Memory:** sending only the last user message per request keeps a clean thread (2 requests gave 4 messages). `memory.recall({ threadId, resourceId })` plus `toAISdkMessages(msgs, { version: 'v7' })` returns UI messages with `tool-<toolKey>` parts. `memory.listThreads({ filter: { resourceId } })` works.
- **Tools:** an error thrown in `execute` propagates to a direct caller. Invalid input returns `{ error: true, message }` instead.
- **Models:** the Mastra model router knows `anthropic/claude-haiku-5-5`, `anthropic/claude-sonnet-5-5`, `openai/gpt-5-mini` and others.
- **Workflows (second spike):**
  - start → `suspended`, with `runId` and `suspendPayload` keyed by step;
  - a fresh `createRun({ runId }).resume({ step, resumeData, requestContext })` → success, and later steps see the resuming request context;
  - `.foreach` returns an array, and `.parallel` returns an object keyed by step id;
  - a tool's `execute` context includes `mastra`, and a tool can start a workflow.
- **Open-Meteo:** the forecast endpoint rejects dates older than about 3 months. The **historical-forecast** endpoint serves 2021 to today+14 days from one URL, and `timezone=auto` works. No key is needed.

## Decisions

| Date | Decision | Why |
|---|---|---|
| 2026-10-16 | Run Mastra as a library inside Deno (`@mastra/hono` + `Deno.serve`), with no Studio in the Deno process | Studio and `mastra dev` are Node-only (issue #5681); everything else works on Deno |
| 2026-10-16 | The deterministic FAO-56 engine sits behind services shared by the tools and `/v1` REST | The AI never computes numbers. The VAPI teammate calls `/v1/advice` directly to stay under 2 s |
| 2026-10-16 | Use Mastra workflows for the multi-step use cases: farm-advice (`.foreach`), simulate-scenario, record-irrigation (suspend/resume confirmation) and morning-warmup (cron) | User's choice ("we can use workflows"). Gives durable confirmations that also work for voice, plus step traces. `/v1` REST stays a direct fast path for VAPI |
| 2026-10-16 | Confirm irrigation records with a suspended workflow run plus a `confirmIrrigation` tool, not with `requireApproval` | Suspend/resume was verified on Deno; the tool-approval round trip through `chatRoute` v7 was not |
| 2026-10-16 | Run the build with the Workflow tool, using Sonnet agents | User's choice; earlier instruction was to use only Sonnet for sub-agents |
| 2026-10-16 | Write the plan as prose and test cases, with no code | User's instruction |
| 2026-10-16 | Identity comes from a Bearer demo token in the seed. Memory resource = farmer id; thread = `farmerId-YYYY-MM-DD` | Simple for the hackathon. The reserved request-context keys prevent cross-farmer memory access |
| 2026-10-16 | Default model is `anthropic/claude-haiku-5-5`, configurable with `MODEL` | Fast for chat; any router model string works |
| 2026-10-16 | `DEMO_DATE=2026-07-05` | Today (October) is outside the seed crops' season; the timeline can still move with `date` |

## Open questions

- Who owns the FAO-56 engine: is it this part or the Data teammate's? The plan includes it in Tasks 2 to 4, behind a clean interface. If Data owns it, those tasks become integration work.
- Where does the hackathon dataset (soil and regional values) live, and in what format? The seed JSON stands in for it for now.
- Crop and soil values in `fao56.ts` come from FAO-56 tables; the Data teammate should cross-check them.
- Which LLM key do we have (Anthropic or OpenAI)?

## Latency

Filled in by Task 12 from `deno task smoke`. Target: first text under 2 s for chat. Voice goes through `/v1` and has no LLM in the loop.

| Date | Question | First byte | First text | Total | Model |
|---|---|---|---|---|---|

## Log

- 2026-10-16: Research done (`research/mastra/`). Spikes verified chatRoute v7, auth middleware, memory override, history conversion and the Open-Meteo range. Plan written.
