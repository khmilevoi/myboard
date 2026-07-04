# syntax=docker/dockerfile:1

# Runs the main Playwright e2e suite (packages/client/e2e, playwright.config.ts)
# fully isolated from the host: no bind mounts, no shared network/ports with
# docker-compose.yml or docker-compose.dev.yml. Chromium + its OS deps are
# installed explicitly and pinned to the workspace's Playwright version, same
# approach as packages/browser-automation/Dockerfile.
FROM node:22-bookworm-slim
WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

RUN corepack enable \
    && apt-get update \
    && apt-get install -y --no-install-recommends fonts-liberation procps \
    && npx -y playwright@1.61.0 install --with-deps chromium \
    && chmod -R 755 /ms-playwright \
    && npm cache clean --force \
    && rm -rf /var/lib/apt/lists/*

COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir /pnpm-store

CMD ["sh", "-c", "pnpm run codegen && pnpm --filter client test:e2e"]
