FROM node:22-alpine
WORKDIR /app
RUN corepack enable
# Copy workspace manifests first for layer caching. Both package manifests are
# required so pnpm can validate the workspace against the frozen lockfile, even
# though only `server` is installed.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/client/package.json ./packages/client/
COPY packages/server/package.json ./packages/server/
RUN pnpm install --frozen-lockfile --filter server...
COPY packages/shared ./packages/shared
COPY packages/widgets ./packages/widgets
COPY packages/server ./packages/server
WORKDIR /app/packages/server
RUN pnpm build
EXPOSE 8787
CMD ["node", "dist/index.cjs"]
