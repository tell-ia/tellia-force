# apps/web — static build served by Caddy. Build context = repo root (pnpm
# workspace: the web app depends on packages/shared), e.g.:
#   docker build -f apps/web/Dockerfile --build-arg VITE_API_URL=... .
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm install --frozen-lockfile --filter @tellia/web...

# Vite inlines VITE_* at build time, so they must be build args, not runtime env.
ARG VITE_API_URL
ARG VITE_API_MODE
ARG VITE_VAPI_PHONE_NUMBER
ARG VITE_VAPI_PUBLIC_KEY
RUN pnpm --filter @tellia/web build

FROM caddy:2-alpine
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
