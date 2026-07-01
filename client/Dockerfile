# syntax=docker/dockerfile:1

# --- build stage: build every widget remote, then assemble the host PWA ---
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY client/package.json ./client/
COPY server/package.json ./server/
COPY shared/package.json ./shared/
COPY widget-runtime/package.json ./widget-runtime/
COPY widget-sdk/package.json ./widget-sdk/
# Widget package discovery is directory-based. Copying the tree before install
# keeps Docker correct when a new widgets/* package is added without editing
# this Dockerfile.
COPY widgets ./widgets
RUN pnpm install --frozen-lockfile

COPY shared ./shared
COPY widget-runtime ./widget-runtime
COPY widget-sdk ./widget-sdk
COPY scripts ./scripts
COPY client ./client

# widget-sdk exposes a `vite-build-exit` bin script (./bin/vite-build.mjs).
# The first install only saw widget-sdk/package.json, so pnpm couldn't link
# that bin into other workspace packages' node_modules/.bin yet. Re-running
# install now that the real widget-sdk sources are in place (offline, from
# the already-resolved store) creates those bin symlinks.
RUN pnpm install --offline --frozen-lockfile

# Typechecking runs in CI. The image build keeps the same production artifact
# order as the root build while invoking Vite directly for the host on slow Pi
# hardware: codegen -> every remote -> host/PWA assembly.
RUN pnpm run codegen \
    && pnpm --filter "./widgets/*" build \
    && pnpm --filter client exec vite-build-exit

# --- runtime stage: serve static files + reverse-proxy /api -> server ---
FROM nginx:alpine AS runtime
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/client/dist /usr/share/nginx/html
EXPOSE 80
