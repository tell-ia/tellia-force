# Mastra (TypeScript) core: agents, tools, memory, workflows, Deno

Date: 2026-10-16. Project: irrigation advisor (phone via VAPI+Twilio, chat via Capacitor). Deterministic FAO-56 numbers; the LLM only runs the conversation; Deno backend.

Legend: [T] = tested by us in a Deno test project with a MOCK model (no real LLM call yet); [D] = from official docs/issues; [U] = unverified.
Docs paths `docs/<path>` map to `https://mastra.ai/docs/<path>` (source: github.com/mastra-ai/mastra, docs/src/content/en/<path>.mdx).

## TL;DR

- Mastra's runtime works on Deno 2.7.7 [T]. `mastra dev`, Studio and `mastra build` are Node-only (issue #5681 closed "not planned") [D]. Run Mastra as a library inside Deno via `@mastra/hono` + `Deno.serve`, and use Node (`npx mastra dev`) only for local Studio.
- Fits the design well: tools wrap the deterministic engine (`get_parcel_report`, `simulate_scenario`...), `requestContext` carries the farmer id, working memory stores farm facts, `requireApproval` guards the irrigation-logging write.
- Built-in cron (`schedule` on a workflow) works on a long-running host [T]; it does not work on serverless. Needs libsql/pg/mysql/mongodb/convex/spanner storage (NOT Upstash).
- Avoid Deno Deploy / edge isolates for now: AJV `new Function()` issue (#14503) hits edge isolates; self-hosted Deno (Railway, Fly, VPS) is fine.
- Hackathon accounts: only an LLM provider key is required. Local file LibSQL is free. Mastra platform, Turso, Neon, Upstash are optional.
- Latency (<2s calls): keep memory light (no semantic recall, no observational memory on the voice path), precompute reports each morning, use a small fast model, maxSteps small. [U: no real-model latency measured]

## Versions (npm, 2026-10-16) [D]

| Package | Version |
|---|---|
| @mastra/core | 1.78.0 (1.79.0-alpha exists) |
| mastra (CLI) | 1.34.2 |
| @mastra/memory | 1.38.0 |
| @mastra/libsql | 1.26.2 |
| @mastra/pg | 1.31.2 |
| @mastra/upstash | 1.5.3 |
| @mastra/client-js | 1.55.0 |
| @mastra/hono | 1.7.20 |
| @mastra/server, @mastra/deployer | 1.78.0 |
| Cloudflare/Vercel/Netlify deployers | 1.2.37 |
| ai (Vercel AI SDK) | 7.0.142 (core supports provider specs v5/v6/v7) |

All need Node >=22.13.0 on paper. zod 3.25+ and 4 both work. Our test used zod ^4 and `ai@6.0.308/test` for MockLanguageModelV3.

## Deno verdict and recommended setup

Tested [T] (Deno 2.7.7, core 1.78.0, mock model, run with `-A`): npm: imports with `"nodeModulesDir":"auto"`; createTool + zod reading `requestContext`; generate() with maxSteps; Memory with working-memory template on file-backed LibSQLStore; createWorkflow/createStep `run.start()`; `@mastra/hono` server via `Deno.serve(app.fetch)` (GET /api/agents = 200); `mastra.startWorkers()` registered the `0 5 * * *` Europe/Paris cron and GET /api/schedules showed `wf_morning-precompute` active. Not exercised: approval flow, real provider, pg on Deno.

Docs list Deno as a supported runtime and `mastra build` output runs on Node/Bun/Deno (docs/deployment/overview.mdx, mastra-server.mdx) [D]. No Deno deployer exists; Netlify Edge Functions (Deno-based) are the closest (reference/deployer/netlify.mdx, target 'edge') [D].

`deno.json` (from the test project):
```json
{
  "nodeModulesDir": "auto",
  "imports": {
    "@mastra/core": "npm:@mastra/core@1.78.0",
    "@mastra/core/": "npm:/@mastra/core@1.78.0/",
    "@mastra/memory": "npm:@mastra/memory@1.38.0",
    "@mastra/libsql": "npm:@mastra/libsql@1.26.2",
    "@mastra/hono": "npm:@mastra/hono@1.7.20",
    "hono": "npm:hono@^4.13.7",
    "zod": "npm:zod@^4"
  }
}
```

`main.ts` skeleton (server + workers):
```ts
import { Mastra } from '@mastra/core'
import { LibSQLStore } from '@mastra/libsql'
import { Hono } from 'hono'
import { MastraServer } from '@mastra/hono'
import { advisor } from './agents/advisor.ts'
import { morningPrecompute } from './workflows/morning.ts'

const storage = new LibSQLStore({ id: 'store', url: Deno.env.get('DB_URL') ?? 'file:./mastra.db' })
const mastra = new Mastra({ agents: { advisor }, workflows: { morningPrecompute }, storage })

const app = new Hono()
const server = new MastraServer({ app, mastra })
await server.init()
Deno.serve({ port: 4111 }, app.fetch)
await mastra.startWorkers()   // REQUIRED with a server adapter, else schedules never fire
```
Run: `deno run -A main.ts` (-A used in test; a narrower permission set is [U]). Local Studio: separate Node project/`npx mastra dev` (Studio is Node-only).

## Agents

- Model as `'provider/model'` string (model router) [D]. `instructions`, `model`, `tools`, `memory` can each be a function of `{ requestContext }` [D]. Per-farmer prompt in test: `instructions: ({requestContext}) => ...` [T].
- `RequestContext` (renamed from RuntimeContext) from `@mastra/core/request-context`; optional `requestContextSchema` [D][T].
- Structured output: `structuredOutput: { schema }` -> `response.object` (old `output` deprecated) [D].
- `maxSteps` default 5; `toolChoice`: auto/none/required/`{type:'tool',toolName}`; `activeTools`; `stopWhen` [D].
- Get the agent via `mastra.getAgentById('advisor')` so it receives shared storage/services [T][D]. `.stream()` returns `textStream` [D].
- `agent.network()` deprecated; use supervisor agents via `agents: {}` [D].
- Voice-call advice: use a small fast model, `toolChoice` default, `maxSteps` 3-4; the report is already precomputed so one tool call suffices.

## Tools

`execute(inputData, context)`; context holds `requestContext`, `abortSignal`, `agent` [D][T]. Use zod schemas (avoids most AJV exposure, see risks).

```ts
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'

export const getParcelReport = createTool({
  id: 'get_parcel_report',
  description: 'Precomputed FAO-56 report for a parcel: whether/when/how many mm to irrigate and why.',
  inputSchema: z.object({ parcel_id: z.string() }),
  outputSchema: z.object({ parcel_id: z.string(), irrigate_mm: z.number(), reason: z.string() }),
  execute: async ({ parcel_id }, ctx) => {
    const farmerId = ctx?.requestContext?.get('farmerId')   // [T]
    return await engine.getReport(farmerId, parcel_id)        // deterministic engine, not the LLM
  },
})

export const recordIrrigation = createTool({
  id: 'record_irrigation',
  description: 'Record that the farmer irrigated a parcel (from their voice report). Requires approval.',
  inputSchema: z.object({ parcel_id: z.string(), mm: z.number(), date: z.string().describe('YYYY-MM-DD') }),
  requireApproval: true,          // defined in test, flow not exercised [T-partial]
  outputValidation: 'warn',       // [D per coordinator] schema mismatch won't make the model retry a write
  execute: async ({ parcel_id, mm, date }, ctx) => {
    await engine.recordEvent(ctx?.requestContext?.get('farmerId'), { parcel_id, mm, date })
    return { ok: true }
  },
})
```
Approval [D]: streaming emits a `tool-call-approval` chunk, then `approveToolCall({runId})` / `declineToolCall({runId, toolCallId, reason})`; with `generate()` the result has `finishReason: 'suspended'`, then `approveToolCallGenerate({runId, toolCallId})`. Tools can also self-suspend with `context.agent.suspend()` + suspendSchema/resumeSchema then `resumeStream()`.
Voice design note: for a phone call, a verbal "Did you water parcel 3 for 40 min, about 12 mm? Yes/no" confirmation inside the conversation may be simpler and faster than the framework approval round trip. [opinion]

Other tools to define the same way: `resolve_parcel(query)`, `simulate_scenario(parcel_id, events[], date)`, `get_weather` (Open-Meteo). MCP/other tool patterns not researched here.

## Memory

- Call with `memory: { resource: farmerId, thread: '<farmerId>-<date>' }` [D][T]. Working memory is resource-scoped by default; a thread's resource owner cannot be changed [D].
- Needs LibSQL/Postgres/Upstash/MongoDB/OracleDB storage [D]. Semantic recall needs a vector store + embedder (e.g. `ModelRouterEmbeddingModel('openai/text-embedding-3-small')`) [D]; skip it for this project.
- Working memory: Markdown template or zod schema. With a schema, updates merge partially, `null` deletes a field, arrays are replaced; `mergeWorkingMemory` exists; `readOnly` supported. `memory.updateWorkingMemory()` sets it from code [D]. Only pg does atomic merges [D].

```ts
import { Memory } from '@mastra/memory'
import { z } from 'zod'

const farmerProfile = z.object({
  name: z.string().optional(),
  language: z.string().optional().describe('Preferred spoken language'),
  parcels: z.array(z.object({
    id: z.string(), nickname: z.string().optional(), crop: z.string().optional(),
    irrigationMethod: z.string().optional(),
  })).optional(),
  preferences: z.object({ callTime: z.string().optional(), unit: z.enum(['mm', 'minutes']).optional() }).optional(),
})

export const memory = new Memory({
  options: { lastMessages: 10, workingMemory: { enabled: true, schema: farmerProfile } },
})
```
Keep agronomic facts (soil, crop stage, events) in the deterministic engine DB, not in working memory; use working memory only for conversational preferences/aliases ("the north field" -> P3). Test used a Markdown template, not the zod schema [T-partial].

Observational memory (OM) [D, docs/memory/observational-memory]: added in @mastra/memory 1.1.0; two background agents (Observer, Reflector) condense message history into a dense observation log once history passes ~30k tokens (Observer) and the log passes ~40k tokens (Reflector); enable with `options: { observationalMemory: true }` or `{ model: 'openai/gpt-5-mini' }`; needs pg/libsql/mysql/mongodb/convex/oracledb storage; thread scope needs a threadId; `scope: 'resource'` is deprecated; observer models should be 128K+ context. Docs do not mark it experimental. Extra latency/cost from the background agents is [U]. With short daily threads it likely never triggers; not needed for the hackathon. OM recall crashes on workerd (#18915) [D].

## Workflows and morning schedule

API [D]: `createWorkflow`, `createStep`, `.then .parallel .branch([[cond, step]]) .map .dountil .dowhile .foreach`, `.commit()`; `createRun()` then `start({inputData, requestContext})` or `.stream()`; `suspend()` snapshots stored, `run.resume({resumeData})`.

```ts
import { createWorkflow, createStep } from '@mastra/core/workflows'
import { z } from 'zod'

const calc = createStep({
  id: 'calc', inputSchema: z.object({}), outputSchema: z.object({ n: z.number() }),
  execute: async () => ({ n: await engine.precomputeAllFarmers() }),   // FAO-56 reports, cached for fast calls
})
export const morningPrecompute = createWorkflow({
  id: 'morning-precompute', inputSchema: z.object({}), outputSchema: z.object({ n: z.number() }),
  schedule: { cron: '0 5 * * *', timezone: 'Europe/Paris', inputData: {} },   // [T] registered, active
}).then(calc).commit()
```
- Scheduling (core >= 1.50.0) only on long-running hosts; storage libsql/pg/mysql/mongodb/convex/spanner; Upstash NOT supported (reference/schedules/overview.mdx) [D]. Must call `mastra.startWorkers()` with a server adapter [T][D].
- Schedule id is `wf_<workflowId>` (`wf_morning-precompute`) [T]; `client.pauseSchedule('wf_<id>')` / `resumeSchedule` [D]. `mastra.schedules.create()` for agent schedules [D].
- Serverless alternative: `@mastra/inngest` (optional) [D]. `Deno.cron` calling `run.start()` also works as a trigger [D per coordinator; not tested here].
- Timing: cron fire does not verify the job ran the cron at exactly 05:00 in the test (only registration shown) [U].

## Server and custom routes

- `@mastra/hono` with `MastraServer({app, mastra}).init()` exposes `/api/*` (agents, workflows, schedules) [T]. Other adapters: express, fastify, koa, elysia, nestjs, next, tanstack-start [D].
- Custom routes: `registerApiRoute()` (get instance with `c.get('mastra')`) or `createRoute()` with zod from `@mastra/server/server-adapter` [D]. Plain Hono routes on the same `app` also work (VAPI webhook, Twilio) [reasonable, not separately tested].
- `server.middleware` can fill `requestContext` (e.g. farmerId from phone number) [D].
- Auth: `{ authenticateToken, mapUserToResourceId }`; reserved key `MASTRA_RESOURCE_ID_KEY` ties memory to the user and returns 403 for other users' resources (docs/server/request-context.mdx) [D].
- VAPI integration (custom-LLM endpoint vs tool webhook) is outside this document.

## Client SDK (@mastra/client-js 1.55.0) [D: docs/server/mastra-client, reference/client-js/agents]

```ts
import { MastraClient } from '@mastra/client-js'
const client = new MastraClient({ baseUrl: 'https://api.example.com' })   // default http://localhost:4111
const agent = client.getAgent('advisor')

// non-streaming
const res = await agent.generate('Which field should I water today?', {
  memory: { thread: 'F42-2026-10-16', resource: 'F42' },
})
console.log(res.text)

// streaming
const stream = await agent.stream('Which field today?', { memory: { thread: 'F42-2026-10-16', resource: 'F42' } })
stream.processDataStream({ onChunk: async (c) => { if (c.type === 'text-delta') ui.append(c.payload.text) } })
```
- Approvals from the client: `agent.listSuspendedRuns({threadId, resourceId})`, `approveToolCall({runId, toolCallId})`, `declineToolCall({..., reason})`; for generate: `requireToolApproval: true` then `approveToolCallGenerate` [D].
- Docs do NOT list `requestContext` as a direct option of client generate/stream (the page shows it only for the React SDK). Safer: derive farmerId server-side from auth/middleware, not from the client [D; confirm in the reference before relying on it].
- Needs Node >=22.13 per docs; runs in browsers/Capacitor WebView is [U] (a plain fetch to `/api/agents/advisor/stream` is the fallback).
- Important: with the memory design above, the Capacitor app should send only thread/resource derived from its auth token, not trust client-sent resource ids.

## Accounts and free tiers (pricing pages fetched 2026-10-16)

| Feature | Package | Account needed? | Free tier? |
|---|---|---|---|
| Framework (agents/tools/workflows) | @mastra/core | No (Apache-2.0) | Free |
| LLM calls | provider via model router | Yes: provider API key (or Mastra Gateway) | Per provider [U] |
| Local storage | @mastra/libsql `file:` | No | Free |
| Hosted SQLite | @mastra/libsql + Turso | Yes (Turso) | Yes: 100 DBs, 5 GB, 500M rows read, 10M rows written /month; paid from $4.99/mo [turso.tech/pricing] |
| Hosted Postgres | @mastra/pg + Neon | Yes (Neon) | Yes: 100 projects, 1 GB/project (20 GB total), 100 CU-hours/project, auto-suspend after 5 min idle; paid pay-as-you-go ($0.106/CU-hr, $0.35/GB-mo) [neon.com/pricing] |
| Redis-style store | @mastra/upstash | Yes (Upstash) | Yes: 500K commands/mo, 250 MB, 10 GB bandwidth; PAYG $0.20/100K commands [upstash.com/pricing/redis]. Cannot host schedules |
| Mastra platform (Studio/Server/Gateway) | optional | Yes if used | Starter $0: unlimited users/deployments, 100K observability events, 24 CPU-hours, 15 days retention; persistent 24/7 server $100/project; Gateway tokens at market +5.5%; Teams $250/mo [mastra.ai/pricing] |
| Serverless cron | @mastra/inngest | Yes (Inngest) | [U] not checked |

Notes: Neon's 5-minute idle suspend means cold-start latency on first query after idle (relevant to the <2s call goal; pg <1.19.0 also added ~3s on first request, #21676 fixed) [D]. Turso is the natural hosted match for libsql (the storage that worked on Deno in our test).

## Risks and gotchas

1. Deno Deploy / Cloudflare / edge: @mastra/core >=1.11 pulls AJV which uses `new Function()`, breaking tool validation on Cloudflare Workers (#14503, open); #15926 lists Deno Deploy as affected (unconfirmed). Self-hosted Deno CLI allows eval so it works; memory tools (template mode) and OM recall crash on workerd (#18915); see also #5212 [D].
2. `mastra dev`/Studio/`mastra build` are Node-only; Deno dev loop lacks Studio (#5681 won't fix) [D].
3. Real model never tested: our run used MockLanguageModelV3. Measure end-to-end latency with the chosen model before committing to <2s [U].
4. Approval flow untested; voice calls may prefer verbal confirmation. A declined/mismatched write tool: set `outputValidation: 'warn'`.
5. Schedules never fire without `mastra.startWorkers()`, on serverless, or with Upstash storage.
6. `@mastra/pg` untested on Deno; libsql worked with `-A` [T].
7. Version churn: core ships frequently (1.79 alpha already); pin exact versions in deno.json/deno.lock.
8. Node >=22.13 requirement is declared by all packages; Deno 2.7.7 worked regardless [T].
9. Keep the LLM away from numbers: tools return deterministic values; instruct the agent to read them verbatim.

## Sources

- Test project (own evidence): /private/tmp/claude-501/-Users-imadez-Desktop-repos-telliaForce-tellia-force/5b46f054-a2ce-40b9-8f7e-7987320dc9e5/scratchpad/denotest/ (main.ts, deno.json)
- https://mastra.ai/docs/server/mastra-client ; https://mastra.ai/reference/client-js/agents
- https://mastra.ai/docs/memory/observational-memory
- https://mastra.ai/pricing ; https://turso.tech/pricing ; https://neon.com/pricing ; https://upstash.com/pricing/redis
- Mastra docs (repo paths under docs/src/content/en/): docs/deployment/overview.mdx, docs/deployment/mastra-server.mdx, reference/deployer/netlify.mdx, reference/schedules/overview.mdx, docs/server/request-context.mdx
- GitHub issues mastra-ai/mastra: #5681, #14503, #15926, #18915, #5212, #21676
- npm registry versions as of 2026-10-16 (earlier agent's verification)
- Note: Context7 was loaded but not needed; gap items were taken from mastra.ai docs/pricing pages directly.
