# syntax=docker/dockerfile:1

# --- build stage: bundle the SPA with Vite ---
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY client/package.json ./client/
COPY server/package.json ./server/
RUN pnpm install --frozen-lockfile --filter client...
COPY shared ./shared
COPY client ./client
# Type-checking runs in CI (`pnpm -r typecheck`); the deploy image only needs
# the bundle, so run Vite directly to keep Raspberry Pi builds fast.
RUN pnpm --filter client exec vite build

# --- runtime stage: serve static files + reverse-proxy /api -> server ---
FROM nginx:alpine AS runtime
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/client/dist /usr/share/nginx/html
EXPOSE 80
