# @tellia/shared — notes for AI agents

The **single source of truth** for everything the Deno API and the React/Capacitor
front both touch. Pure Zod + inferred types, no runtime deps beyond `zod`.

## Rule
Never redefine a contract on one side. If it crosses the wire, or both sides must
agree on it, it lives here. Zod schemas double as runtime validation
(API: Hono `zValidator`; front: `schema.parse()`).

## Files
- `api.ts` — wire envelope (`ok`, `paginated`, `ApiErrorSchema`), pagination
  (`PaginationQuerySchema`, `PageMetaSchema`), primitives (`IdSchema`, `TimestampsSchema`).
- `entities.ts` — domain models (`User`, `Profile`, `Item`, …) in camelCase,
  matching what the API returns (not raw DB columns).
- `dto.ts` — request bodies, **derived** from entities (`.omit`/`.pick`/`.partial`)
  so they can't drift from the model.
- `env.ts` — `ServerEnvSchema` (API) + `ClientEnvSchema` (web, `VITE_*` only) +
  `parseEnv` (fail-loud boot validation). Keep secrets OUT of the client schema.
- `index.ts` — barrel; also re-exports `env` as a namespace.

## Consumed by
- `apps/api` via the deno.json import map (`@tellia/shared`, relative path).
- `apps/web` as a pnpm workspace dep (`"@tellia/shared": "workspace:*"`).

## Conventions
- Internal imports are **extensionless** (`./api`, not `./api.ts`) so both tsc
  (web) and Deno (sloppy-imports) resolve them.
- Put as much as makes sense here. Adding a resource = add its entity + DTOs here
  first, then wire API + web.
