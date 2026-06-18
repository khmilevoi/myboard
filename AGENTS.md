# Repository Guidelines

## Agent-Specific Instructions

Always load and follow `C:\Users\Khmil\.agents\skills\reatom` and `C:\Users\Khmil\.agents\skills\errore` before working in this repository. Use Reatom for atoms, actions, async flows, tests, and React integration; use errore for TypeScript errors-as-values, tagged errors, and flat early-return control flow.

## Project Structure & Module Organization

This is a private pnpm workspace with two packages: `client` and `server`. The React/Vite app lives in `client/src`, with feature folders such as `app`, `board`, `storage`, `theme`, `widget-host`, and `widget-registry`. Standalone widget entries live under `client/widgets/<widget-name>` and are auto-discovered by Vite when they include an `index.html`. Client e2e tests live in `client/e2e`; package-level and component tests are colocated as `*.test.ts` or `*.test.tsx`. The storage API lives in `server/*.ts`, builds to `server/dist`, and uses Valkey.

## Build, Test, and Development Commands

Use pnpm from the repository root.

- `pnpm dev`: start the client Vite dev server.
- `pnpm dev:server`: start the server in watch mode.
- `pnpm build`: typecheck and build the client.
- `pnpm --filter server build`: bundle server with Rspack.
- `pnpm test`: run workspace Vitest tests.
- `pnpm test:e2e`: run client Playwright tests.
- `pnpm typecheck`: run workspace TypeScript checks.
- `pnpm docker:dev`: run Valkey, server, and client with hot reload.
- `pnpm docker:up`: build and run the production-style Docker stack.

## Coding Style & Naming Conventions

Use TypeScript and ESM imports. Follow the existing style: 2-space indentation, single quotes, no semicolons, named exports, and CSS Modules named `*.module.css`. React components use PascalCase filenames such as `Header.tsx`; utility modules use kebab-case or domain names such as `board-storage.ts`. Widget directories use kebab-case.

## Testing Guidelines

Vitest is the unit/component test runner; React tests use Testing Library and jsdom. Keep tests near the code they verify as `*.test.ts` or `*.test.tsx`. Playwright specs belong in `client/e2e`, with page helpers in `client/e2e/pages`. Run `pnpm test` and `pnpm typecheck` before opening a PR; run `pnpm test:e2e` for browser-facing behavior.

## Commit & Pull Request Guidelines

Recent history uses Conventional Commit prefixes, including `fix:`, `build:`, and `chore:`. Keep commits focused and imperative, for example `fix: random key generation`. PRs should summarize scope, list verification commands, link related issues when applicable, and include screenshots or short recordings for UI changes.

## Security & Configuration Tips

Do not commit `.env` files. Client environment examples live in `client/.env.example`; server configuration uses `PORT` and `VALKEY_URL`. Prefer Docker commands when changes depend on Valkey or the full client/server stack.
