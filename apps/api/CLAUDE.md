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
- Typecheck: `deno task check`.
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
```
