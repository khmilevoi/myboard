# syntax=docker/dockerfile:1

# --- widget-manifests stage: reduce packages/widgets to package.json files so
# the install layer re-keys on manifest changes, not widget sources (mirrors the
# server image). Browser task discovery stays directory-based via browser.ts.
FROM node:22-alpine AS widget-manifests
COPY packages/widgets /widgets
RUN find /widgets -mindepth 2 -maxdepth 2 ! -name package.json -exec rm -rf {} +

# --- build stage: codegen:browser (generated registry is git/docker-ignored and
# MUST be generated here) + rspack bundle to dist/index.cjs ---
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY patches ./patches
COPY packages/browser-automation/package.json ./packages/browser-automation/
COPY packages/client/package.json ./packages/client/
COPY packages/server/package.json ./packages/server/
COPY packages/shared/package.json ./packages/shared/
COPY packages/widget-runtime/package.json ./packages/widget-runtime/
COPY packages/widget-sdk/package.json ./packages/widget-sdk/
COPY --from=widget-manifests /widgets ./packages/widgets
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 pnpm install --frozen-lockfile --store-dir /pnpm-store

COPY packages/shared ./packages/shared
COPY packages/widgets ./packages/widgets
COPY scripts ./scripts
COPY packages/browser-automation ./packages/browser-automation

RUN pnpm run codegen:browser && pnpm --filter browser-automation build

# --- runtime stage: slim Node/Debian base with ONLY Chromium, pinned to the
# workspace Playwright version, plus the Xvfb + noVNC recovery surface. Firefox
# and WebKit are never installed (unlike the official Playwright image). ---
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Chromium (+ its OS deps) pinned to 1.61.0; the noVNC recovery surface; a
# writable X socket dir; a profile dir owned by the non-root `node` user (an empty
# named volume inherits this ownership). `--with-deps chromium` installs only
# Chromium's libraries; PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD affects only the npm
# postinstall, never this explicit install.
RUN corepack enable \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
       xvfb x11vnc novnc websockify fonts-liberation \
    && npx -y playwright@1.61.0 install --with-deps chromium \
    && chmod -R 755 /ms-playwright \
    && mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix \
    && mkdir -p /profile && chown node:node /profile \
    && npm cache clean --force \
    && rm -rf /var/lib/apt/lists/*

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY patches ./patches
COPY packages/browser-automation/package.json ./packages/browser-automation/
COPY packages/client/package.json ./packages/client/
COPY packages/server/package.json ./packages/server/
COPY packages/shared/package.json ./packages/shared/
COPY packages/widget-runtime/package.json ./packages/widget-runtime/
COPY packages/widget-sdk/package.json ./packages/widget-sdk/
COPY --from=widget-manifests /widgets ./packages/widgets
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --filter browser-automation --prod --store-dir /pnpm-store

COPY --from=build /app/packages/browser-automation/dist ./packages/browser-automation/dist
COPY packages/browser-automation/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

USER node
WORKDIR /app/packages/browser-automation
ENV BROWSER_PROFILE_DIR=/profile
EXPOSE 8788 6080
ENTRYPOINT ["/docker-entrypoint.sh"]
