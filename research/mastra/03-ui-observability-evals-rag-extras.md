# Mastra research 03: UI, observability, evals, RAG, guardrails, extras

Researched 2026-10-16. Sources: Context7 (/websites/mastra_ai), mastra.ai docs, GitHub mastra-ai/mastra. Items marked **[UNVERIFIED]** were not confirmed in a primary source. I did not run any code.

## TL;DR

- **Chat UI**: use `chatRoute()` from `@mastra/ai-sdk` plus AI SDK `useChat` (pass `version: 'v7'` to handlers). Tool calls arrive as `tool-<toolKey>` parts with states `input-available`, `output-available`, `output-error`, so rendering a `<ParcelReportCard/>` is a simple switch. Capacitor is not documented anywhere, but this is plain fetch/SSE to a remote HTTPS server, so it should work **[UNVERIFIED]**. Test it on a real device early.
- **Studio**: `mastra dev` serves it at localhost:4111. It has agent chat, tool runner, traces, scorers, datasets and experiments, and swagger at /swagger-ui. Use it as the judge-facing "under the hood" demo.
- **Tracing**: `MastraStorageExporter` works locally with no account. Langfuse (cloud or self-host), Braintrust, Arize, OTel providers and the Mastra platform each need an account. The platform Starter tier is free, with 100K events and 15 days of retention.
- **Evals**: a custom code-only scorer can check that every mm figure in the answer appears in the tool output. Run it in CI via `runEvals` with gates, and live via `agent.scorers` with sampling.
- **RAG**: skip it for numbers. FAO-56 tables belong in deterministic code. Optional: a tiny RAG over agronomy notes, only for "why" explanations. Priority is low.

## 1. Chat UI

### Options

| Option | Package | Fit for us |
|---|---|---|
| AI SDK `useChat` + `chatRoute` | `@mastra/ai-sdk`, `@ai-sdk/react`, `ai` | Best. Documented, supports tool parts, HITL suspend. |
| `MastraClient` | `@mastra/client-js` | Good for non-React or custom clients. Doc says it is "designed for browser environments and uses native fetch". Has `agent.stream` and `clientTools`. |
| assistant-ui | `assistant-ui` CLI scaffolds a Next.js frontend that points at `chatRoute` | Nice polish, but the scaffold is Next.js. Mastra's page does not cover tool UI. |
| CopilotKit | `@ag-ui/mastra`, `@copilotkit/react-core`, `@copilotkit/react-ui` | Rich generative UI (tool-call rendering, frontend tools, HITL). Heavier. `@copilotkit/runtime` must be excluded via `bundler.externals` or deployed builds can return 500. |

Sources: mastra.ai/docs/frameworks/agentic-uis/ai-sdk, .../assistant-ui, .../copilotkit, mastra.ai/docs/server/mastra-client.

### Server (Hono, Deno)

```ts
import { chatRoute } from '@mastra/ai-sdk'
export const mastra = new Mastra({
  agents: { irrigationAdvisor },
  server: { apiRoutes: [chatRoute({ path: '/chat/:agentId', version: 'v7' })] }, // `version` option placement: check ref
})
```

Doc example is `chatRoute({ path: '/chat', agent: 'weatherAgent' })` or `path: '/chat/:agentId'` (source: ai-sdk page, assistant-ui page). The docs say handlers default to AI SDK v5 and need `version: 'v7'` for v7. Whether `chatRoute` itself takes that option is **[UNVERIFIED]**. `toAISdkStream(stream, { from: 'agent', version: 'v7' })` is documented (Context7, /guides/streaming).

Hono adapter: `new MastraServer({ app, mastra }); await server.init()` (Context7, /server/server-adapters). The docs example uses `@hono/node-server`. Swapping in `Deno.serve({ port }, app.fetch)` is expected to work, and the Mastra server docs say the compiled server runs on "Node.js, Bun, or Deno". The `@mastra/hono` adapter on Deno specifically is **[UNVERIFIED]**.

### Client: tool calls as cards

Each tool call is a `tool-{toolKey}` part. Define an `outputSchema` on the tool so the output is typed (ai-sdk page).

```tsx
const { messages, sendMessage } = useChat({
  transport: new DefaultChatTransport({ api: `${API}/chat/irrigationAdvisor` }),
})
// render
if (part.type === 'tool-getParcelReport') {
  if (part.state === 'input-available') return <Skeleton/>
  if (part.state === 'output-available') return <ParcelCard {...part.output} /> // mm, when, why, ET0 bars
  if (part.state === 'output-error') return <ErrorCard msg={part.errorText}/>
}
if (part.type === 'tool-simulateScenario') /* timeline card */
```

Note the part type uses the key in `tools: {...}`, not the tool `id` (ai-sdk page). Persisted history: `toAISdkMessages(msgs, { version: 'v7' })` from `@mastra/ai-sdk/ui`.

**Trust pattern**: the card shows the tool's numbers. The assistant text only adds the one-sentence reason.

### Capacitor

- No Mastra doc mentions Capacitor or React Native. The client-js page says to check the reference before assuming it works there.
- In practice the app is a WebView calling a remote server. Gotchas (general web knowledge, **[UNVERIFIED]** for Mastra):
  - CORS: Capacitor origins are `capacitor://localhost` or `https://localhost` (Android), so allow them on the Hono server. `credentials: 'include'` needs credentialed CORS (client-js page).
  - SSE streaming in iOS WKWebView generally works with fetch. Do not use Capacitor's native HTTP plugin with streams.
  - The server must be HTTPS, not localhost, on a device.

### Human-in-the-loop

Tools can `suspend()`. The stream emits a `data-tool-call-suspended` part, and the client resumes with `runId` and `resumeData`. This needs storage configured (ai-sdk page). It could power "Confirm: water field 3 for 22 mm?".

## 2. Studio

- `mastra dev` (or `npm run dev`) serves it at localhost:4111, with REST docs at /swagger-ui and `--https` available.
- Features: agent chat with model switching, individual tool runs, workflow graph and step runs, processors and MCP inspection, request context variables, traces/logs/metrics, scorers results, datasets and experiments (compare up to 10 against a baseline).
- It can be hosted on the Mastra platform or self-hosted, with auth available.

Source: mastra.ai/docs/studio/overview. Demo: run the "drought" edge case from the UI and show the trace tree, the tool outputs, and the scorer result live.

Our backend runs on Deno, but Studio runs via Node locally. Keep `src/mastra/index.ts` exporting the `mastra` instance so both entrypoints share it.

## 3. Observability and tracing

Tracing is built in. Config:

```ts
import { Observability, MastraStorageExporter, SensitiveDataFilter } from '@mastra/observability'
import { LangfuseExporter } from '@mastra/langfuse'
new Mastra({
  observability: new Observability({ configs: { default: {
    serviceName: 'tellia-irrigation',
    exporters: [new MastraStorageExporter(), new LangfuseExporter()],
    spanOutputProcessors: [new SensitiveDataFilter()],
  }}})
})
```

Sources: mastra.ai/docs/observability/overview, /studio/observability, /tracing/overview (Context7).

- `MastraStorageExporter` persists traces for Studio. It replaces the deprecated `DefaultExporter`. The LibSQL store supports traces and the DuckDB store supports metrics for local use. Production metrics are recommended on ClickHouse.
- `MastraPlatformExporter` sends to the Mastra platform when `MASTRA_PLATFORM_ACCESS_TOKEN` is set.
- Exporters that need an external account:
  - `@mastra/langfuse`: public and secret keys, cloud or self-hosted via `LANGFUSE_BASE_URL`.
  - `@mastra/braintrust`: Braintrust account **[UNVERIFIED: API key details not fetched]**.
  - `@mastra/arize`: Phoenix endpoint and key.
  - LangSmith **[UNVERIFIED: exporter package not confirmed in what I read]**.
  - `@mastra/otel-exporter`: providers Dash0, Datadog (needs a Datadog Agent), SigNoz, New Relic, Traceloop, Laminar, Sentry, MLflow, Latitude, telemetry.dev, or a custom OTLP endpoint.
  - `@mastra/otel-bridge`: experimental, no Mastra account.
- Span filtering: `excludeSpanTypes: [SpanType.MODEL_CHUNK, SpanType.MODEL_STEP]` and a `spanFilter` function. `customSpanFormatter` is per exporter.
- `SensitiveDataFilter` redacts passwords, tokens and keys. It is not a PII filter for farmer names or phone numbers, so add a processor for that.
- Platform pricing (mastra.ai/pricing): Starter is $0 with 100K observability events (then $10 per 100K), 24 CPU hours, 15 days retention, unlimited users, projects and deployments. A persistent 24/7 server is not included on Starter ($100/project). Teams is $250/month.

**Recommendation for the hackathon**: use `MastraStorageExporter` only (zero accounts). Add Langfuse cloud if you want a shareable trace URL for judges.

## 4. Evals and scorers

### Built-ins (mastra.ai/docs/evals/built-in-scorers)

- LLM-judged accuracy: answer-relevancy, faithfulness, hallucination (lower is better), completeness, prompt-alignment, answer-similarity.
- Tool scorers: tool-call-accuracy (correct tool selected), trajectory-accuracy (expected action sequence).
- Context scorers: context-precision, context-relevance.
- Output quality: toxicity and bias (lower is better), tone-consistency, keyword-coverage.
- `multi-turn-judge`.
- Zero-LLM `checks.*`: includes, excludes, equals, matches, similarity, calledTool, didNotCall, toolOrder, maxToolCalls, usedNoTools, noToolErrors.

Which scorers are LLM-based versus code-based is not stated on the overview page. Only `checks.*` is explicitly zero-LLM. Imports from the docs: `createAnswerRelevancyScorer` from `@mastra/evals/scorers/prebuilt`, `checks` from `@mastra/evals/checks`, `createScorer` and `runEvals` from `@mastra/core/evals`.

### Custom scorer: stated mm must equal tool output

The docs show `createScorer` with preprocess, analyze, generateScore and generateReason, and a code-only scorer (omit `judge`). They show `extractToolCalls(run.output)` returning tool names in `.tools`. The docs do not show the full shape of tool results, so how to read tool output from `run.output` is **[UNVERIFIED]**. Inspect `run.output` in a first run.

```ts
import { createScorer } from '@mastra/core/evals'
import { extractToolCalls } from '@mastra/evals/scorers/utils'

export const mmGroundedScorer = createScorer({
  id: 'mm-grounded',
  description: 'Every "N mm" in the answer appears in tool outputs',
  type: 'agent',
})
  .preprocess(({ run }) => {
    const text = String(run.output.text ?? '')
    const said = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*mm/gi)].map(m => parseFloat(m[1].replace(',', '.')))
    // TODO: pull numbers out of tool results (inspect run.output shape first)
    const toolNums: number[] = collectNumbersFromToolResults(run.output)
    return { said, toolNums }
  })
  .generateScore(({ results }) => {
    const { said, toolNums } = results.preprocessStepResult
    return said.every(n => toolNums.some(t => Math.abs(t - n) < 0.05)) ? 1 : 0
  })
  .generateReason(({ score }) => (score ? 'all mm match tool output' : 'mm not found in tool output'))
```

For voice calls, numbers may be spoken in words ("twelve millimetres"). Make the model output digits, or normalize in the scorer.

An alternative that avoids parsing prose: use `structuredOutput` with a schema `{ field, whenISO, mm, reason }`, then compare `mm` to the tool's `mm` in code. Even stronger: have the agent not state numbers at all, and render them from the tool card.

### Live vs CI

- **Live**: attach to an agent with sampling, for example `scorers: { mmGrounded: { scorer: mmGroundedScorer, sampling: { type: 'ratio', rate: 1 } } }`. Results show in Studio and in storage (mastra.ai/docs/evals/overview). Use rate 1 for the cheap code scorers and 0.1 to 0.5 for LLM judges.
- **CI**: `runEvals({ data, target: agent, gates: [checks.calledTool('get_parcel_report'), checks.noToolErrors()], scorers: [{ scorer: mmGroundedScorer, threshold: 1 }] })`, then check `result.verdict` ('passed', 'scored' or 'failed') and exit with a non-zero code on failure (mastra.ai/docs/evals/gates-and-verdicts, /running-in-ci). The docs show it under Vitest.
- Datasets and experiments are also in Studio.

## 5. RAG

- `@mastra/rag` provides `MDocument` with chunking (recursive 512/50 in the docs example). Embeddings go through `embedMany` and `ModelRouterEmbeddingModel`. Vector stores listed on the RAG overview page: pgvector, OracleDB, Pinecone, Qdrant, MongoDB. LibSQLVector is used by memory (Context7). The overview page did not cover `createVectorQueryTool`, graph RAG or reranking, so I did not verify them.
- **Recommendation: do not use RAG for FAO-56 numbers.** Kc values, stage lengths and the water-balance maths are exactly the "must not invent numbers" category. Retrieval over chunked tables risks wrong rows, and the answer is a pure lookup in code. Put the tables in typed constants and expose them via the deterministic tools.
- Where RAG is cheap and useful (optional, low priority):
  1. Short agronomy notes (symptoms of stress, local advice) for the one-sentence "why", cited by source.
  2. A "learn more" chat mode.
  Use LibSQLVector (local file) so no account is needed. If time is short, hardcode a reason-template per rule instead.

## 6. Guardrails and structured output

Input and output processors are set on the Agent (mastra.ai/docs/agents/guardrails, /processors):

```ts
import { PIIDetector, ModerationProcessor, LanguageDetector, PromptInjectionDetector } from '@mastra/core/processors'
new Agent({
  inputProcessors: [
    new LanguageDetector({ model, targetLanguages: ['English','en'], strategy: 'translate', threshold: 0.8 }),
    new PIIDetector({ model, strategy: 'redact', redactionMethod: 'mask', detectionTypes: ['email','phone','credit-card'] }),
    new PromptInjectionDetector({ model, strategy: 'block' }),
  ],
  outputProcessors: [new ModerationProcessor({ model, strategy: 'block' })],
})
```

- Processors can be combined as a workflow with parallel steps (Context7 example).
- Processors call an LLM, which adds latency. For voice calls, keep them minimal. LanguageDetector with `translate` is relevant for farmers who speak local languages, but accuracy for low-resource languages is **[UNVERIFIED]**.
- Mastra has no built-in "numbers must come from tools" processor that I found. The custom scorer or a custom output processor is the way to enforce it **[UNVERIFIED: custom processor API not read]**.
- Structured output uses a Zod schema, as in the network example: `structuredOutput: { schema }` with `objectStream` and `object` (Context7). The same option for `agent.generate` and `agent.stream` is expected **[UNVERIFIED]**.

## 7. Templates, CLI, MCP docs server

- `npx create-mastra@latest` scaffolds the server (assistant-ui page).
- Templates in github.com/mastra-ai/mastra/tree/main/templates (28 directories). Descriptions for most are inferred from names by the fetch tool, so check them before relying on them. Likely useful:
  - `weather-agent`: closest starting point for us.
  - `template-genui-data-explorer`: generative UI for data.
  - `template-docs-expert`: web search, citations, memory, structured responses (described in the README).
  - `template-company-knowledge`: pgvector RAG (described in the README).
  - `template-starter-agent`: durable agent harness with resumable streams and Postgres/Redis (described in the README).
- UI examples: ui-dojo.mastra.ai with a GitHub repo (generative UI, workflows, agent networks, custom events).
- Coding agents: `claude mcp add --scope project mastra -- npx -y @mastra/mcp-docs-server@latest`. The docs say it is "not recommended for everyday development" and recommend the Mastra skill instead. Mastra packages also ship a `SKILL.md` in `dist/docs` that agents can read from node_modules (mastra.ai/docs/build-with-ai/mcp-docs-server).

## 8. Other notable features (relevance /5)

| Feature | Note | Relevance |
|---|---|---|
| Workflows (`createWorkflow`, suspend/resume) | Morning pipeline: fetch weather, then water balance, then advice, with an approval step. Graph view in Studio. | 4 |
| Memory (`@mastra/memory`, LibSQL, semantic recall) | Remember the farmer's fields and preferences across calls. | 4 |
| Datasets and experiments in Studio | Regression-test the edge cases (drought, flood, frost, hail). | 4 |
| Suspend tools (HITL) | Confirm irrigation actions. | 3 |
| A2A, MCP servers (`@mastra/mcp`) | Expose tools over MCP. Low priority. | 2 |
| Agent networks, harness/agent controller | Not needed. | 1 |
| Channels (CopilotKit channels, Slack) | Not needed. | 1 |
| Voice | Not researched here. VAPI is the voice layer in this project. | n/a |

Sources: mastra.ai/docs/studio/overview, Context7 pages above. Items I did not read in depth are only listed by name.

## 9. Top 10 ideas, ranked by demo impact over effort

1. **Tool-call cards in chat**: `tool-getParcelReport` renders mm, time and reason as a card, with a skeleton while loading. Highest impact, low effort.
2. **Studio trace walkthrough**: show weather tool, water-balance tool, answer, in one trace, plus the scorer result. Zero effort.
3. **`mm-grounded` custom scorer** shown live in Studio with a green score, and a deliberate failure demo (hallucinated number). Low to medium effort.
4. **Structured output** `{field, when, mm, reason}` so UI and voice use the same typed answer. Low effort.
5. **Edge-case generator as a `runEvals` suite**: each preset (drought, flood, frost, hail) is a CI case with gates (`calledTool('simulate_scenario')`). Medium effort.
6. **Movable timeline calling `simulate_scenario`** with the card re-rendering from the tool output. Medium effort, high wow.
7. **Memory** for the farmer's fields and units ("my north field"). Low effort.
8. **Morning-advice workflow** with a suspend step that asks for confirmation. Medium effort.
9. **Guardrails**: PIIDetector on the input (voice transcripts) and PromptInjectionDetector. Low effort, trust story.
10. **Langfuse or platform trace link** for judges. Low effort, needs an account.

Skipped on purpose: RAG over FAO-56 tables (see section 5).

## 10. Accounts table

| Feature | Package | Account needed? | Free tier? |
|---|---|---|---|
| Chat route + useChat | `@mastra/ai-sdk`, `@ai-sdk/react` | No | n/a (LLM provider key still needed) |
| Mastra client | `@mastra/client-js` | No | n/a |
| assistant-ui | `assistant-ui` | No (assistant-ui cloud not required) **[UNVERIFIED]** | n/a |
| CopilotKit | `@ag-ui/mastra`, `@copilotkit/*` | No for self-hosted runtime **[UNVERIFIED]** | n/a |
| Studio (local) | `mastra` CLI | No | Yes |
| Studio hosted + platform traces | `MastraPlatformExporter` | Yes (`MASTRA_PLATFORM_ACCESS_TOKEN`) | Yes, Starter $0 (100K events, 15 days) |
| Local traces | `@mastra/observability` `MastraStorageExporter` + `@mastra/libsql` / `@mastra/duckdb` | No | Yes |
| Langfuse | `@mastra/langfuse` | Yes (cloud) or self-host | Free tier on Langfuse **[UNVERIFIED]** |
| Braintrust | `@mastra/braintrust` | Yes | **[UNVERIFIED]** |
| LangSmith | not confirmed | Yes | **[UNVERIFIED]** |
| Arize Phoenix | `@mastra/arize` | Endpoint + key (Phoenix can be self-hosted **[UNVERIFIED]**) | **[UNVERIFIED]** |
| OTel | `@mastra/otel-exporter` | Provider-dependent; bridge needs none | Provider-dependent |
| Evals (built-in, checks, custom code scorer) | `@mastra/evals`, `@mastra/core/evals` | No (LLM-judged scorers need a model key) | n/a |
| RAG | `@mastra/rag` + `@mastra/libsql` | No for LibSQL; Pinecone etc. yes | n/a |
| Guardrail processors | `@mastra/core/processors` | No (they call an LLM, so a model key is needed) | n/a |
| MCP docs server | `@mastra/mcp-docs-server` | No | Yes |

## 11. Risks and gotchas

- Version defaults: `handleChatStream()` and `toAISdkStream()` default to older AI SDK versions (v5, and v5 respectively). Always pass the version explicitly (ai-sdk page).
- Deno: the `@mastra/hono` adapter and `chatRoute` on Deno are not verified. Test `Deno.serve` with `app.fetch` on day one. Studio needs Node.
- Capacitor: CORS origins, HTTPS, streaming on iOS. Test on a device early.
- Tool part names use the tools-object key, so renaming a key breaks the UI.
- `MastraPlatformExporter` silently needs a token. Without it nothing is sent.
- `SensitiveDataFilter` redacts secrets, not farmer PII.
- LLM-based processors and scorers add latency and cost. Keep them off the voice hot path or sample them.
- The custom scorer's tool-result access is not documented in what I read. Inspect `run.output` first.
- Persistent 24/7 platform server is not in the free tier ($100/project), so self-host the server.
- CopilotKit deploys: `@copilotkit/runtime` must be in `bundler.externals`.

## 12. Sources

- Context7 /websites/mastra_ai (guides/streaming, observability, evals, guardrails, memory, server adapters)
- https://mastra.ai/docs/frameworks/agentic-uis/ai-sdk
- https://mastra.ai/docs/frameworks/agentic-uis/assistant-ui
- https://mastra.ai/docs/frameworks/agentic-uis/copilotkit
- https://mastra.ai/docs/server/mastra-client
- https://mastra.ai/docs/studio/overview
- https://mastra.ai/docs/observability/overview
- https://mastra.ai/docs/observability/tracing/exporters/langfuse
- https://mastra.ai/docs/observability/tracing/exporters/otel
- https://mastra.ai/pricing
- https://mastra.ai/docs/evals/built-in-scorers, /custom-scorers, /gates-and-verdicts, /running-in-ci
- https://mastra.ai/docs/agents/guardrails, /processors
- https://mastra.ai/docs/rag/overview
- https://mastra.ai/docs/build-with-ai/mcp-docs-server
- https://github.com/mastra-ai/mastra/tree/main/templates
