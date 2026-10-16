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
                       # weather (DB + Open-Meteo), service, REST /irrigation (no LLM)
      chat/            # Mastra: advisor agent, 8 tools, 4 workflows, POST /chat,
                       # GET /chat/history, x-member-id middleware. See chat/README.md
  scripts/smoke.ts     # real-model smoke test against a running server
  tests/               # offline suite; tests/live/ needs RUN_LIVE_TESTS=1
```

## Irrigation and chat
- **Numbers come from the engine, never the LLM.** Tools return them; the agent copies them.
- **Several farms share the DB** (`farm_id` on every farm table, weather per region `nuts3_id`). Until the
  API takes a farm per request, `supabaseFarmData` serves the first farm only (`servedFarm()`): its members,
  fields and region weather. Inserts may omit `farm_id`: a DB trigger copies it from the field.
- **Only `confirmed` irrigations count** in the water balance. The assistant saves `draft`
  operations and confirms them only when the same member resumes the `record-irrigation`
  workflow with `confirmed: true`. Declined drafts are deleted.
- **`MODEL`** (env, default `openai/gpt-6.1-sol`) is the chat model, `MODEL_MINI` is for thread
  titles. Both use `OPENAI_API_KEY`. `DEMO_DATE` pins "today".
- Identity is the `x-member-id` header (no auth, team decision): don't expose the server
  publicly, `/api/*` exposes Mastra's built-in routes.
- Tests and agents must never write to the shared Supabase DB. The 8 tool keys are a UI
  contract; don't rename them.
