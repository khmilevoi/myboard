# syntax=docker/dockerfile:1

# --- widget-manifests stage: reduce packages/widgets to its package.json
# files (plus .ports.json) so install layers re-key only on manifest changes,
# not on widget sources. Widget discovery stays directory-based: a new widget
# adds a package.json, which changes this stage's output and re-installs.
FROM node:22-alpine AS widget-manifests
COPY packages/widgets /widgets
RUN find /widgets -mindepth 2 -maxdepth 2 ! -name package.json -exec rm -rf {} +

# --- build stage: codegen (widget server registry is git-ignored and
# dockerignored, it MUST be generated here) + rspack bundle ---
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
# codegen imports every widgets/*/client.ts through tsx + widget-sdk sources,
# so the full workspace install is required in this stage. The store lives in
# a BuildKit cache mount so cache-missed installs skip the network.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir /pnpm-store

COPY packages/shared ./packages/shared
COPY packages/widget-runtime ./packages/widget-runtime
COPY packages/widget-sdk ./packages/widget-sdk
COPY packages/widgets ./packages/widgets
COPY scripts ./scripts
COPY packages/server ./packages/server

RUN pnpm run codegen && pnpm --filter server build

# --- runtime stage: dist + server's production deps only ---
FROM node:22-alpine AS runtime
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/client/package.json ./packages/client/
COPY packages/server/package.json ./packages/server/
COPY packages/shared/package.json ./packages/shared/
COPY packages/widget-runtime/package.json ./packages/widget-runtime/
COPY packages/widget-sdk/package.json ./packages/widget-sdk/
COPY --from=widget-manifests /widgets ./packages/widgets
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --filter server --prod --store-dir /pnpm-store
COPY --from=build /app/packages/server/dist ./packages/server/dist
WORKDIR /app/packages/server
EXPOSE 8787
CMD ["node", "dist/index.cjs"]
