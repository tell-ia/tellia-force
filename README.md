# Tellia Force — EU Ag Hackathon

Hackathon monorepo — mobile-first app.

- **`apps/api`** — Deno + Hono backend on Supabase.
- **`apps/web`** — Vite + React + Tailwind front, wrapped for Android with Capacitor.
- **`packages/shared`** — `@tellia/shared`: Zod schemas shared by both sides (contracts, DTOs, env).
- **`seed/`** — Python script that rebuilds the Supabase database (demo farm, real weather, FAO-56 tables). See `seed/README.md`.

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

## Android (TL;DR)
```bash
# 0. API running: cd apps/api && deno task start
# 1. Set apps/web/.env  ->  emulator: http://10.0.2.2:8000 | real phone: http://<Mac-LAN-IP>:8000
cd apps/web && pnpm build && pnpm cap:sync && pnpm cap:run   # pick device/emulator
```
- `android/` is committed — networking (cleartext/mixed-content) works out of the box.
- VS Code: run **"Android app + API (debug)"** (one click, starts API too).
- Debug the WebView on device: `chrome://inspect`.
- Prod (https API): drop `cleartext`/`allowMixedContent` in `capacitor.config.ts`.

See `CLAUDE.md` (root + each package) for conventions. Plans live in `plans/`.
