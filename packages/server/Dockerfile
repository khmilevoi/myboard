# syntax=docker/dockerfile:1

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
# Widget package discovery is directory-based (same trick as the client image).
COPY packages/widgets ./packages/widgets
# codegen imports every widgets/*/client.ts through tsx + widget-sdk sources,
# so the full workspace install is required in this stage.
RUN pnpm install --frozen-lockfile

COPY packages/shared ./packages/shared
COPY packages/widget-runtime ./packages/widget-runtime
COPY packages/widget-sdk ./packages/widget-sdk
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
COPY packages/widgets ./packages/widgets
RUN pnpm install --frozen-lockfile --filter server --prod
COPY --from=build /app/packages/server/dist ./packages/server/dist
WORKDIR /app/packages/server
EXPOSE 8787
CMD ["node", "dist/index.cjs"]
