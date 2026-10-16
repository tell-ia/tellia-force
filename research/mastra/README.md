# Mastra research: index

Research for the Mastra part of [`plans/plan.md`](../../plans/plan.md) (irrigation advisor, Deno backend, chat + VAPI voice).
Researched 2026-10-16 against `@mastra/core` 1.78.0. Claims in each file are tagged as tested, from docs, or unverified, with sources.

| File | What's inside |
|---|---|
| [01-core-agents-tools-memory-workflows-deno.md](01-core-agents-tools-memory-workflows-deno.md) | Agents, tools (`get_parcel_report`, `record_irrigation` with approval), farmer working memory, workflows + morning cron, server routes, client SDK, **Deno verdict** (smoke-tested) |
| [02-voice-vapi-twilio-messaging.md](02-voice-vapi-twilio-messaging.md) | VAPI integration options, call-flow diagram, latency budget, Twilio/French number rules, WhatsApp vs Telegram, Mastra MCP |
| [03-ui-observability-evals-rag-extras.md](03-ui-observability-evals-rag-extras.md) | `useChat` + tool-call cards, Studio, tracing, the "mm-grounded" scorer, RAG (skip), guardrails, **top-10 hackathon ideas** |

## Key decisions

1. **Mastra runs inside the Deno backend** via `@mastra/hono` + `Deno.serve(app.fetch)`. This was actually run on Deno 2.7.7 (01). Use Node (`npx mastra dev` / `mastra studio`) only for local Studio. Avoid Deno Deploy and edge isolates (AJV `new Function()` issue #14503).
   - File 03 marks `@mastra/hono` on Deno as unverified, but file 01 tested it.
2. **Morning advice uses Mastra's built-in workflow `schedule`** (`cron` + `timezone`). It needs a long-running process, a call to `mastra.startWorkers()`, and LibSQL or Postgres storage (not Upstash). `Deno.cron` is not needed.
3. **Voice = VAPI option (a), tool webhooks.** VAPI's LLM calls our deterministic FAO-56 endpoints, which return a short French sentence. There is no Mastra LLM in the voice loop, which keeps calls under 2 s. The full Mastra agent with memory serves chat, WhatsApp and Telegram (02).
4. **No RAG for the numbers.** FAO-56 tables stay in deterministic code. A custom code scorer checks that every "N mm" in a reply matches what the tool returned (03).
5. **Local LibSQL file for storage** during the hackathon. It's free, needs no account, and was tested on Deno. Neon auto-suspends after 5 minutes idle, which causes cold starts during calls.

## Accounts checklist

| Service | Needed? | Why | Free tier / gotcha |
|---|---|---|---|
| **LLM provider** (OpenAI / Anthropic / …) | **Yes** | Mastra agent (chat), LLM-judged scorers, guardrails | Pay per token |
| **VAPI** | **Yes** (voice) | STT/LLM/TTS orchestration, phone calls | $5 credits, then $0.05/min + provider costs; free number is US-only and inbound-only |
| **Twilio** | **Yes** (FR number, SMS, WhatsApp sandbox) | Phone number imported into VAPI | 30-day trial, calls only up to 5 verified numbers. **French Local/Mobile numbers prohibit automated outbound calls**, so check this before buying a number for the morning call |
| Telegram (BotFather) | Optional | Fastest messaging channel for the demo | Free |
| Meta WhatsApp Cloud API | Optional (prod) | Real WhatsApp | Business verification; templates required outside the 24 h window |
| Tunnel (ngrok / cloudflared) | Yes for dev | Public HTTPS URL for VAPI/Twilio webhooks | Free tiers exist |
| Mastra account / platform | **No** | Optional hosted Studio/traces | Starter $0 (100K events, 15 days); 24/7 server $100/project |
| Turso / Neon / Upstash | No | Optional hosted storage | Turso 5 GB free; Neon suspends after 5 min idle; Upstash can't host schedules |
| Langfuse / Braintrust / Arize | No | Optional external tracing | Local `MastraStorageExporter` needs no account |

## Still unverified (test first)

- Real-model latency against the 2 s call budget. All tests so far used a mock model.
- The `requireApproval` flow end to end.
- The VAPI `tool-calls` webhook timeout, and the fields in the end-of-call report.
- Capacitor plus streaming chat on a real device (CORS, HTTPS).
- `@mastra/pg`, `@mastra/voice-*` and `@mastra/mcp` running on Deno.
