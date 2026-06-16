FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY package.json ./
RUN pnpm install
COPY tsconfig.json tsconfig.node.json ./
COPY server ./server
EXPOSE 8787
CMD ["pnpm", "exec", "tsx", "server/index.ts"]
