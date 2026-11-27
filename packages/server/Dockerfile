# syntax=docker/dockerfile:1

# --- widget-manifests stage: reduce packages/widgets to its package.json
# files (plus .ports.json) so install layers re-key only on manifest changes,
# not on widget sources. Widget discovery stays directory-based: a new widget
# adds a package.json, which changes this stage's output and re-installs.
FROM node:26-alpine AS widget-manifests
COPY packages/widgets /widgets
RUN find /widgets -mindepth 2 -maxdepth 2 ! -name package.json -exec rm -rf {} +
# Module packages get the same treatment: manifests only, sources arrive after the install.
COPY packages/modules /modules
RUN find /modules -mindepth 2 -maxdepth 2 ! -name package.json -exec rm -rf {} +

# --- build stage: codegen (widget server registry is git-ignored and
# dockerignored, it MUST be generated here) + rspack bundle ---
FROM node:26-alpine AS build
WORKDIR /app
# node:26-alpine no longer bundles corepack (removed from Node core); install
# it explicitly before enabling it. Pinned: there is no CI, so a breaking
# corepack release would only surface as a failed manual deploy.
RUN npm install -g corepack@0.35.0 && corepack enable

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.json ./
COPY patches ./patches
COPY packages/client/package.json ./packages/client/
COPY packages/image-codec/package.json ./packages/image-codec/
COPY packages/server/package.json ./packages/server/
COPY packages/shared/package.json ./packages/shared/
COPY packages/widget-runtime/package.json ./packages/widget-runtime/
COPY packages/widget-sdk/package.json ./packages/widget-sdk/
COPY packages/scan-camera/package.json ./packages/scan-camera/
COPY --from=widget-manifests /widgets ./packages/widgets
COPY --from=widget-manifests /modules ./packages/modules
# Server codegen only emits directory-derived server imports. The full workspace
# install remains required in this stage. The store lives in a BuildKit cache
# mount so cache-missed installs skip the network.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir /pnpm-store

COPY packages/image-codec ./packages/image-codec
COPY packages/shared ./packages/shared
COPY packages/widget-runtime ./packages/widget-runtime
COPY packages/widget-sdk ./packages/widget-sdk
COPY packages/widgets ./packages/widgets
COPY packages/modules ./packages/modules
COPY scripts ./scripts
COPY packages/server ./packages/server

RUN pnpm run codegen:server && pnpm --filter server build

# --- runtime stage: dist + server's production deps only ---
FROM node:26-alpine AS runtime
WORKDIR /app
RUN npm install -g corepack@0.35.0 && corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY patches ./patches
COPY packages/client/package.json ./packages/client/
COPY packages/image-codec/package.json ./packages/image-codec/
COPY packages/server/package.json ./packages/server/
COPY packages/shared/package.json ./packages/shared/
COPY packages/widget-runtime/package.json ./packages/widget-runtime/
COPY packages/widget-sdk/package.json ./packages/widget-sdk/
COPY packages/scan-camera/package.json ./packages/scan-camera/
COPY --from=widget-manifests /widgets ./packages/widgets
COPY --from=widget-manifests /modules ./packages/modules
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --filter server --prod --store-dir /pnpm-store
COPY --from=build /app/packages/server/dist ./packages/server/dist
WORKDIR /app/packages/server
EXPOSE 8787
CMD ["node", "dist/index.cjs"]
