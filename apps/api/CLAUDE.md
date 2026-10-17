# Tellia Force API — notes for AI agents

Backend for the hackathon app. **Deno 2 + Hono**, data in **Supabase**.
See product/design/compute context in Notion (link in root `CLAUDE.md`).

## Runtime & stack
- **Deno 2** (not Node). Web-standard `Request`/`Response`. Deps via `deno.json`
  import map (`npm:` / `jsr:` specifiers), not package.json.
- **Hono** router — use `zValidator` + middleware for cross-cutting concerns
  (CORS, error mapping), not per-route boilerplate.
- **Supabase** via `@supabase/supabase-js`. One **service-role** client (`src/supabase.ts`)
  — **no auth** for the hackathon, so it bypasses RLS.
- Shared contracts imported from `@tellia/shared/*` via the import map (relative
  path to `packages/shared/src`). `sloppy-imports` unstable flag lets Deno load
  those extensionless TS imports.

## Conventions
1. **Contracts live in `@tellia/shared`** — never redefine a DTO/entity here.
   Validate every request with the shared Zod schema (`zValidator`).
2. **One error shape** — throw `HTTPException`; `core/middleware.ts#onError`
   maps everything to the shared `ApiError` envelope.
3. **Snake_case DB ↔ camelCase entity** — map at the module boundary (`toItem`),
   never leak raw Supabase rows to the client.
4. **Self-contained modules** under `src/modules/<name>/`, wired in `src/main.ts`.
   New resource = copy `modules/items/`.

## Commands
- Dev: `deno task dev` (watch, loads `.env`, serves on `PORT`).
- Typecheck: `deno task check`. Offline tests: `deno task test` (no LLM, no network, no Supabase writes).
- Live LLM tests: `deno task test:live` (real `OPENAI_API_KEY`, in-memory farm; `RUN_DB_TESTS=1` adds one read-only Supabase check).
- Smoke a running server: `deno task start`, then `SMOKE_URL=http://localhost:<port> deno task smoke` (read-type questions only).
- Cache deps: `deno cache src/main.ts`.

## Layout
```
apps/api/
  deno.json              # tasks + import map (hono, supabase, zod, @tellia/shared)
  .env.example           # SUPABASE_* + PORT + CORS_ORIGINS
  src/
    main.ts              # build Hono app, middleware, mount modules, Deno.serve
    config.ts            # env parse via @tellia/shared/env (fail loud)
    supabase.ts          # service-role Supabase client
    core/middleware.ts   # onError -> shared ApiError envelope
    modules/
      items/items.controller.ts   # example CRUD, copy for new resources
      irrigation/      # FAO-56 engine (pure), FarmData (Supabase + in-memory twin),
                       # weather (DB + Open-Meteo), service, REST /irrigation (no LLM);
                       # farmInfo / productCheck / farmLookup services (journal, E-Phy, sales)
      chat/            # Mastra: advisor agent, 13 tools, 5 workflows, POST /chat,
                       # GET /chat/history, x-member-id middleware. See chat/README.md
      vapi/            # phone assistant: POST /vapi/tools, 12 phone tools. See vapi/README.md
      voice/           # chat mic: POST /voice/session mints a short-lived OpenAI Realtime
                       # transcription key (gpt-live-transcribe); the app streams over WebRTC
  scripts/smoke.ts     # real-model smoke test against a running server
  scripts/vapiSetup.ts # pushes the phone tools + prompt to VAPI (agents: --dry-run only)
  tests/               # offline suite; tests/live/ needs RUN_LIVE_TESTS=1
```

## Irrigation and chat
- **Numbers come from the engine, never the LLM.** Tools return them; the agent copies them.
- **Several farms share the DB** (`farm_id` on every farm table, weather per region `nuts3_id`). Every
  request works on the **caller's farm**: `x-member-id` → member → `farm_id` (default: main contact of the
  first farm). `irrigation/farmRegistry.ts` caches one `{data, weather, service}` scope per farm, so weather
  caches never mix regions. `createSupabaseFarmData(db, farmId)` filters every farm table on `farm_id`
  and reads weather by the farm's `nuts3_id`; another farm's field, member or operation is 404/400.
  Chat tools and workflows take the farm from the request context (`FARM_ID_KEY`), never from input.
  Inserts may omit `farm_id`: a DB trigger copies it from the field.
- **Only `confirmed` irrigations count** in the water balance. The assistant saves `draft`
  operations and confirms them only when the same member resumes the `record-irrigation`
  workflow with `confirmed: true`. Declined drafts are deleted. Corrections work the same way:
  `correctIrrigation` starts `correct-irrigation`, which changes or deletes a confirmed
  irrigation only after the same member's yes. `confirmIrrigation` resumes both workflows.
- **The 5 workflows**: `farm-advice`, `simulate-scenario`, `record-irrigation`,
  `correct-irrigation`, `morning-warmup` (`chat/workflows/index.ts`).
- **The 13 chat tool keys** (`chat/tools.ts`, a UI contract): `resolveField`, `getFarmAdvice`,
  `getFieldReport`, `simulateScenario`, `getWeather`, `getIrrigationHistory`, `recordIrrigation`,
  `confirmIrrigation`, `getFieldDetails`, `getFieldJournal`, `checkProductUse`,
  `correctIrrigation`, `lookupFarmData`. Their output schemas are in `@tellia/shared/irrigation`
  and `@tellia/shared/farm`. The phone has the same tools in snake_case, without
  `confirmIrrigation` (the voice asks first, then calls `record_irrigation` or
  `correct_irrigation` directly; refused for unknown callers).
- **`MODEL`** (env, default `openai/gpt-6.1-sol`) is the chat model, `MODEL_MINI` is for thread
  titles. Both use `OPENAI_API_KEY`.
- **"Today" is one clock** (`modules/settings/clock.ts`), read through `registry.today()`: the demo
  date set from the app (`PUT /settings/date`, kept in `data/demo-date.json`), else `DEMO_DATE`,
  else the real date. The app, the chat and VAPI all follow it. Never read the real date elsewhere.
- Identity is the `x-member-id` header (no auth, team decision): don't expose the server
  publicly, `/api/*` exposes Mastra's built-in routes.
- Tests and agents must never write to the shared Supabase DB. The 13 tool keys are a UI
  contract; don't rename them.
