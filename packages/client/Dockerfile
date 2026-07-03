# syntax=docker/dockerfile:1

# --- widget-manifests stage: reduce packages/widgets to its package.json
# files (plus .ports.json) so the install layer below re-keys only on
# manifest changes, not on widget sources. Widget discovery stays
# directory-based: a new widget adds a package.json, which changes this
# stage's output and correctly re-runs the install.
FROM node:22-alpine AS widget-manifests
COPY packages/widgets /widgets
RUN find /widgets -mindepth 2 -maxdepth 2 ! -name package.json -exec rm -rf {} +

# --- build stage: build every widget remote, then assemble the host PWA ---
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/client/package.json ./packages/client/
COPY packages/server/package.json ./packages/server/
COPY packages/shared/package.json ./packages/shared/
COPY packages/widget-runtime/package.json ./packages/widget-runtime/
COPY packages/widget-sdk/package.json ./packages/widget-sdk/
COPY --from=widget-manifests /widgets ./packages/widgets
# The store lives in a BuildKit cache mount, so even when this layer is
# invalidated the packages come from the persistent builder cache instead of
# the network (pnpm copies out of the mount since hardlinks can't cross it).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir /pnpm-store

COPY packages/shared ./packages/shared
COPY packages/widget-runtime ./packages/widget-runtime
COPY packages/widget-sdk ./packages/widget-sdk
COPY packages/widgets ./packages/widgets
COPY scripts ./scripts
COPY packages/client ./packages/client

# widget-sdk exposes a `vite-build-exit` bin script (./bin/vite-build.mjs).
# The first install only saw widget-sdk/package.json, so pnpm couldn't link
# that bin into other workspace packages' node_modules/.bin yet. Re-running
# install now that the real widget-sdk sources are in place (offline, from
# the already-resolved store) creates those bin symlinks.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --offline --frozen-lockfile --store-dir /pnpm-store

# Typechecking runs in CI. The image build keeps the same production artifact
# order as the root build while invoking Vite directly for the host on slow Pi
# hardware: codegen -> every remote -> host/PWA assembly.
RUN pnpm run codegen:client \
    && pnpm --filter "./packages/widgets/*" build \
    && pnpm --filter client exec vite-build-exit

# --- runtime stage: serve static files + reverse-proxy /api -> server ---
FROM nginx:alpine AS runtime
COPY packages/client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/client/dist /usr/share/nginx/html
EXPOSE 80
