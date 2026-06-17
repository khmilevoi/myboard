# syntax=docker/dockerfile:1

# --- build stage: bundle the SPA with Vite ---
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# Type-checking runs in CI (`pnpm typecheck`); the deploy image only needs the bundle.
RUN pnpm exec vite build

# --- runtime stage: serve static files + reverse-proxy /api -> server ---
FROM nginx:alpine AS runtime
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
