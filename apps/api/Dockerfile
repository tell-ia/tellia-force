# apps/api — Deno backend image. Build context = repo root (the API imports
# packages/shared through its deno.json import map), e.g.:
#   docker build -f apps/api/Dockerfile .
FROM denoland/deno:2.7.7

WORKDIR /app
COPY packages/shared/src packages/shared/src
COPY apps/api/deno.json apps/api/deno.lock apps/api/
COPY apps/api/src apps/api/src

WORKDIR /app/apps/api
RUN deno cache --sloppy-imports src/main.ts

# Mastra LibSQL lives in ./data (mount a volume there to keep chat memory).
# Env comes from the platform, so no --env-file here (unlike `deno task start`).
CMD ["deno", "run", "--sloppy-imports", "--allow-net", "--allow-read", "--allow-env", "--allow-ffi", "--allow-write", "--allow-sys", "src/main.ts"]
