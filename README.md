# Tellia Force — EU Ag Hackathon

Hackathon monorepo — mobile-first app.

- **`apps/api`** — Deno + Hono backend on Supabase.
- **`apps/web`** — Vite + React + Tailwind front, wrapped for Android with Capacitor.
- **`packages/shared`** — `@tellia/shared`: Zod schemas shared by both sides (contracts, DTOs, env).

> 📚 Design / compute / product context lives in **Notion**:
> https://app.notion.com/p/Hackaton-3f8a8fc1d5f3809a93edf5e7134df186?source=copy_link

## Prerequisites
- [pnpm](https://pnpm.io) ≥ 10, Node ≥ 20
- [Deno](https://deno.com) 2
- A Supabase project (URL + anon key + service-role key)
- For Android: Android Studio + JDK 17

## Setup
```bash
pnpm install
cp apps/api/.env.example apps/api/.env   # fill SUPABASE_* 
cp apps/web/.env.example apps/web/.env   # fill VITE_SUPABASE_*
cd apps/api && deno cache src/main.ts && cd ../..
```

## Dev
```bash
pnpm dev                 # web + api together (turbo)
# or separately:
cd apps/api && deno task dev
cd apps/web && pnpm dev
```

## Android
```bash
cd apps/web
pnpm build
npx cap add android      # first time only
pnpm cap:sync
pnpm cap:open            # opens Android Studio
```

See `CLAUDE.md` (root + each package) for conventions. Plans live in `plans/`.
