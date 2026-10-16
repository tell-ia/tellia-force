# Chat & irrigation advisor: TODO

The detailed behavior is in [plan.md](plan.md), and the log is in [progress.md](progress.md).

## Setup / accounts
- [x] OpenAI key (`apps/api/.env` → `OPENAI_API_KEY`), used by the default model `openai/gpt-5-mini`
- [x] Supabase tables and data exist (read on 2026-10-16)
- [x] Open-Meteo needs no account
- [x] Mastra needs no account (OSS, local LibSQL)

## MVP (plan tasks)
- [x] 1. Setup: deno.json (Mastra deps, permissions), env (`MODEL`, `MASTRA_DB_URL`, `DEMO_DATE`, `TIMEZONE`), shared `irrigation.ts` contracts, `FarmData` interface, utils
- [ ] 2. Engine: Saxton–Rawls soil water, root depth and p, Kc from `crop_stage` by GDD fraction (falling back to `crop_ref`)
- [ ] 3. Engine: water balance, field report (decision and a one-sentence reason), ranking
- [ ] 4. Engine: scenario events (drought, flood, frost, hail, rain, irrigation) and comparison
- [ ] 5. Data: Supabase `FarmData` (paginated reads, irrigation writes), the in-memory twin, the fixture
- [ ] 6. Weather: DB history plus Open-Meteo gap and forecast, GDD, climatology, cache
- [ ] 7. Irrigation service: report, advice, simulate, weather, preview, draft, confirm, cancel, record
- [ ] 8. REST `/irrigation/*` (the fast path for VAPI)
- [ ] 9. Mastra workflows: farm-advice, simulate-scenario, record-irrigation (suspend/resume), morning-warmup (05:00)
- [ ] 10. Mastra tools: the 7 keys that make up the UI contract
- [ ] 11. Advisor agent: no invented numbers, memory per member, two-turn confirmation
- [ ] 12. Chat module: `POST /chat` (v7), `GET /chat/history`, `x-member-id` middleware, `startWorkers`
- [ ] 13. Docs (module README, api CLAUDE.md), smoke script, latency

## Hand-offs to teammates
- [ ] UI (Marceau): the chat contract and tool-card table in `apps/api/src/modules/chat/README.md`, plus typed client methods in `apps/web/src/lib/api.ts`
- [ ] VAPI owner: `GET /irrigation/advice` and `POST /irrigation/operations` (voice path with no LLM)
- [ ] Data teammate: review the root depth and p table and the GDD/stage method
- [ ] Human-run check: the record → confirm flow against the real DB (agents must not write to Supabase)

## Backlog (after MVP, ranked by demo value)
- [ ] Morning `alert` rows ("actions of the day") from `morning-warmup`, once the table's owner agrees
- [ ] `mm-grounded` custom scorer: every "N mm" in a reply must match the tool output (research 03 §4)
- [ ] Mastra Studio for the demo: a Node entry point using the same agent and workflows
- [ ] VAPI voice confirmation: REST start/resume for `record-irrigation`
- [ ] Log WhatsApp and call messages to the `message` table
- [ ] Structured output for the final answer; guardrails on chat only; tracing (`MastraStorageExporter`, optional Langfuse)
- [ ] Water-restriction quota across fields; water and pumping saved compared with a fixed schedule
- [ ] Move Mastra storage to Supabase Postgres if needed
