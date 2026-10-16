# Chat backend: TODO

Detailed steps are in [plan.md](plan.md). Tick items here as tasks land, and log details in [progress.md](progress.md).

## Setup / accounts
- [ ] LLM API key (Anthropic for the default `anthropic/claude-haiku-5-5`, or set `MODEL` for another provider) → `backend/.env`
- [x] Open-Meteo needs no account
- [x] Mastra needs no account (OSS, local LibSQL)

## MVP (plan tasks)
- [ ] 1. Scaffold `backend/` (deno.json pinned, config, date utils)
- [ ] 2. FAO-56 crop and soil tables, Kc curve
- [ ] 3. Water balance, parcel report (decision + one-sentence reason), ranking
- [ ] 4. Scenario events: drought, flood, frost, hail, rain, irrigation
- [ ] 5. Open-Meteo provider with cache
- [ ] 6. Seed farmers/parcels, `resolveParcel`, irrigation record store (LibSQL)
- [ ] 7. Advisor services (report, farm advice, simulate, weather, record)
- [ ] 8. Mastra workflows: farm-advice, simulate-scenario, record-irrigation (suspend → confirm → save), morning-warmup (05:00)
- [ ] 9. Mastra tools: 7 keys are the UI contract, including `confirmIrrigation`
- [ ] 10. Advisor agent (instructions forbid invented numbers, memory per farmer, two-turn confirmation)
- [ ] 11. HTTP: `POST /chat` (v7 stream), `GET /chat/history`, `/v1/*` REST, bearer auth, CORS for Capacitor, schedule, `main.ts`
- [ ] 12. Real-model smoke + latency numbers + `backend/README.md` API contract

## Hand-offs to teammates
- [ ] Share `backend/README.md` chat contract with UI (Marceau): `useChat` config + tool card table
- [ ] Share `/v1/advice` + `/v1/irrigations` with the VAPI owner (voice path without an LLM)
- [ ] Ask the Data teammate to review `src/domain/fao56.ts` values and the hackathon data format

## Backlog (after MVP, ranked by demo value)
- [ ] `mm-grounded` custom scorer: check that every "N mm" in the reply matches tool output (research 03 §4). Inspect `run.output` shape first
- [ ] Mastra Studio for the demo: a small Node entry (`npx mastra dev`) importing the same agent/tools
- [ ] VAPI voice confirmation: let the VAPI owner start and resume `record-irrigation` (e.g. `/v1/irrigations/start` and `/v1/irrigations/:runId/confirm`)
- [ ] Structured output `{ parcelId, decision, mm, reason }` for a typed final answer
- [ ] Guardrails on chat only: PromptInjectionDetector, PIIDetector (they cost latency, so keep them off voice)
- [ ] Tracing: `MastraStorageExporter` (no account), optional Langfuse link for judges
- [ ] Hackathon dataset adapter replacing `data/seed.json` (regional soil, 1,151 EU regions)
- [ ] Water-restriction quota: share a limited volume across parcels by urgency
- [ ] Water and pumping saved vs fixed-schedule irrigation (the "proof" metric in the product plan)
- [ ] Deploy (Railway/Fly/VPS; not Deno Deploy, issue #14503) with Turso or a persisted volume
