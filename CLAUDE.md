# Tellia Force — notes for AI agents

Hackathon monorepo. Mobile-first app: **Deno + Hono API** on **Supabase**, a
**React + Vite + Tailwind** front wrapped for **Android with Capacitor**, and a
**shared Zod package** that is the single source of truth for every contract both
sides use.

> **📚 Design, compute & product spec live in Notion** — lots of context there:
> https://app.notion.com/p/Hackaton-3f8a8fc1d5f3809a93edf5e7134df186?source=copy_link
> Read it before building features. Code conventions are here; the *what/why*
> (design, data, compute) is in Notion.

## Layout (pnpm + turborepo)
- `packages/shared` — `@tellia/shared`. All Zod schemas + inferred types shared
  by API and front: `api.ts` (envelope, pagination, primitives), `entities.ts`
  (domain models), `dto.ts` (request bodies, derived from entities), `env.ts`
  (env validation for both sides). **Never redefine a contract on one side.**
- `apps/api` — **Deno 2 + Hono**, talks to **Supabase** via `@supabase/supabase-js`.
  Imports `@tellia/shared/*` through the deno.json import map (relative path).
- `apps/web` — **Vite + React 19 + Tailwind 4**, **Capacitor** → Android.
  Consumes `@tellia/shared` as a pnpm workspace dep. Reusable native-aware
  components in `src/components/`.

## Stack decisions (hackathon)
- **No auth.** API uses the Supabase service-role key and bypasses RLS. If auth
  is added later, switch to anon key + per-request user JWT (see git history of
  `apps/api/src/supabase.ts`).
- **One source of truth for contracts = `@tellia/shared`.** Zod schemas double as
  runtime validation (Hono `zValidator` on the API, `schema.parse()` on the front).
- Put as much as makes sense in shared Zod: entities, DTOs, env, wire envelope.

## Commands (from repo root)
- Install: `pnpm install` (also `cd apps/api && deno cache src/main.ts`).
- Dev everything: `pnpm dev` (turbo runs web + api). Or per app:
  - API: `cd apps/api && deno task dev` (needs `apps/api/.env`).
  - Web: `cd apps/web && pnpm dev` (needs `apps/web/.env`).
- Typecheck: `pnpm check-types` (web via `tsc -b`, shared via `tsc`, API via `deno task check`).
- Android: `cd apps/web && pnpm build && pnpm cap:sync && pnpm cap:open`.

## Env
Copy each `.env.example` to `.env` (git-ignored):
- `apps/api/.env` — `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `PORT`, `CORS_ORIGINS`.
- `apps/web/.env` — `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
Env is validated at boot by `@tellia/shared/env` — missing vars crash loud.

## Git
- Remote: `git@github.com:tell-ia/tellia-force.git`. Work on `main`.
- Commit freely; **push only when the user says so**.
- End commit messages with the Co-Authored-By trailer.

## Adding a resource (pattern)
1. Add its entity to `packages/shared/src/entities.ts` + DTOs to `dto.ts`.
2. New module `apps/api/src/modules/<name>/<name>.controller.ts` — copy `items`,
   validate with the shared schemas, back it with the `db` Supabase client.
3. Mount it in `apps/api/src/main.ts`.
4. Add client methods in `apps/web/src/lib/api.ts` (parse responses with shared schema).
