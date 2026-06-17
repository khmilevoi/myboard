FROM node:22-alpine
WORKDIR /app
RUN corepack enable
# Copy workspace manifests first for layer caching. Both package manifests are
# required so pnpm can validate the workspace against the frozen lockfile, even
# though only `server` is installed.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY client/package.json ./client/
COPY server/package.json ./server/
RUN pnpm install --frozen-lockfile --filter server...
COPY server ./server
WORKDIR /app/server
EXPOSE 8787
CMD ["pnpm", "exec", "tsx", "index.ts"]
