# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

See [AGENTS.md](./AGENTS.md) for the canonical repository guidelines (project structure, coding style, required skills, commit/PR conventions). This file adds command references and architecture notes that complement it — read both.

## Required skills

Before editing this repo, load the `reatom` and `errore` skills (referenced in AGENTS.md):

- **Reatom**: used for all atoms, actions, async flows, and React integration in `packages/client/`.
- **errore**: used for TypeScript errors-as-values (tagged errors, `instanceof` narrowing, no throwing) across both `packages/client/` and `packages/server/`.

## Commands

Run from the repo root with pnpm unless noted.

```bash
pnpm dev                      # codegen, then board + every widget dev server in parallel
pnpm dev:server                # codegen, then server in watch mode
pnpm build                     # codegen, build every widget remote, then typecheck/build the client host and PWA
pnpm --filter server build     # bundle server with Rspack
pnpm test                      # all workspace Vitest tests
pnpm --filter client test      # client tests only
pnpm --filter server test      # server tests only
pnpm test:e2e                  # board Playwright e2e against the assembled production-style Vite output
pnpm --filter client test:e2e:nginx # with docker compose up --build -d running, smoke-test the actual nginx image
pnpm typecheck                 # workspace-wide tsc --noEmit
pnpm lint / pnpm lint:fix       # oxlint
pnpm format / pnpm format:check # oxfmt
pnpm docker:dev                 # Valkey + server + client with hot reload
pnpm docker:up                  # production-style Docker stack
```

Run a single test file or test name with Vitest directly, e.g.:

```bash
pnpm --filter client exec vitest run src/widget-registry/model/registry.test.ts
pnpm --filter client exec vitest run -t "test name substring"
```

Playwright specs (`packages/client/e2e`) can be filtered the same way:

```bash
pnpm --filter client exec playwright test e2e/<file>.spec.ts
```

## Architecture

**Workspace layout**: pnpm workspace with all packages under `packages/`: the `client` Vite/React host, the `server` Node API, `shared`, singleton `widget-runtime`, stateless `widget-sdk`, and independently built `packages/widgets/*` packages. `@/*` aliases only to `packages/client/src`; shared widget code is imported through the two workspace package names.

### Widget system

- **`packages/client/src/widget-registry`**: synchronous codegen-generated catalog metadata and icon map. Only `loadComponent` crosses the Module Federation boundary when a placed widget mounts.
- **`packages/widgets/<widget-name>`**: one pnpm package per widget, split into `model/` and `ui/`, exposing only `./ui` as a federation remote and providing a standalone `dev/` harness. Adding a widget package and running codegen updates the client catalog, server registry, and stable port map without editing a hand-written registry.
- **`packages/client/src/widget-host`**: mounts first-party widget components in the board React tree and provides frame/error-boundary/fullscreen behavior.
- **`widget-runtime` / `widget-sdk`**: shared runtime contracts/connections and stateless React/UI helpers respectively. React, React DOM, Reatom, and `widget-runtime` are strict federation singletons.

### Storage system (offline-first + sync)

`packages/widget-runtime/src/storage` owns per-widget instance/shared scopes, Dexie and HTTP backends, SSE/BroadcastChannel fanout, and Reatom bindings. Board and standalone harnesses construct the same `WidgetRuntimeProps`; widgets do not import storage through `packages/client/src`.

### Server (storage API)

`packages/server/src/index.ts` is a plain `node:http` server routed with `find-my-way`, backed by Valkey (Redis-compatible):

- REST-ish endpoints under `/api/storage` (`GET`/`PUT`/`DELETE` by key, prefix listing, atomic `append` via `runExclusive` per-key locking in `storage/key-lock.ts`).
- `GET /api/storage/events` opens an SSE stream; clients `POST /api/storage/events/:connId` to subscribe/unsubscribe to key prefixes. Server-side fanout (`realtime/sse.ts`) is driven by a Valkey pub/sub subscriber on the `storage:events` channel, so writes from any server instance reach all connected SSE clients.
- All request/response bodies are validated with Zod schemas (`storage/schemas.ts`); validation failures return 422 with a formatted Zod error.
- Errors and control flow follow the errore pattern (tagged errors / `Error | T` unions) rather than throwing.

### Reatom + component convention

Every exported React function component in `packages/client/src` and `packages/widgets/*` is wrapped with `reatomMemo` from `widget-sdk`. Business logic, derived state, timers, and async flows belong in `model/`; `ui/` keeps refs, DOM interop, and minimal view glue. Class error boundaries stay internal and expose a `reatomMemo` wrapper.

## Deployment

`pi.toml` configures deployment to a Raspberry Pi target via `docker-compose.yml`, with the `client` service as the ingress (port 80) and a generous 30-minute build timeout (SPA build + server image build is slow on Pi hardware). The client image builds every widget remote first, stages them under `/widgets/<id>/`, and precaches them in the same PWA release.

## Agent routing with Superpowers

Three roles, three models. Opus orchestrates, Sonnet implements, Codex GPT-5.5 reviews.

| Role | Model | How it is invoked |
| --- | --- | --- |
| Orchestrator | Opus | the main session (`model: opus`) |
| Implementer | Sonnet | `Agent` tool → `sonnet-superpowers-implementer` subagent |
| Reviewer | Codex GPT-5.5 | `codex exec review` via `Bash` (external CLI, not a Claude subagent) |

### Rules

- The main Claude Code session is the orchestrator and must stay on Opus.
- Do not use the main Opus session for routine implementation. Dispatch every implementation task to the `sonnet-superpowers-implementer` subagent.
- Use Superpowers workflows normally and do not skip their review loops: brainstorming → writing-plans → executing-plans / subagent-driven-development → verification-before-completion → finishing-a-development-branch.

### Automated feature-by-plan loop

Run this loop for each independent task in the plan; the orchestrator drives it end to end without manual steps:

1. **Dispatch** the task to `sonnet-superpowers-implementer` via the `Agent` tool. Sonnet writes tests first (TDD) and makes minimal local changes.
2. **Verify locally** (verification-before-completion): run the relevant `pnpm test` / `pnpm typecheck` / `pnpm lint` for the touched packages. Do not proceed until they pass.
3. **Codex review — automatic.** The orchestrator runs the review itself via `Bash` (do **not** rely on `/codex:review`; that slash command has `disable-model-invocation: true`, so Opus cannot invoke it — only the human can). Use the real GPT-5.5 slug `gpt-5.5`:
   ```bash
   # branch-scoped review against main (default for a completed plan task)
   codex exec review --base main -m gpt-5.5
   # or working-tree review while iterating
   codex exec review --uncommitted -m gpt-5.5
   ```
   `codex exec review` is read-only by nature — it only reads the diff and returns findings, it never patches.
4. **Triage.** The orchestrator parses Codex's findings. If Codex reports blocking issues, dispatch the fixes back to `sonnet-superpowers-implementer` with the finding text, then return to step 2. Repeat until Codex is clean.
5. **Finish** with finishing-a-development-branch once the whole plan is implemented, locally green, and Codex-clean.

### Manual / backstop options (optional)

- `/codex:review --model gpt-5.5` — the `codex@openai-codex` plugin command for an interactive, nicely-formatted review (supports `--background` + `/codex:status`). Human-triggered only.
- `/codex:setup --enable-review-gate` — enables the plugin's `Stop` review gate as a safety net that forces a Codex pass before the session can finish, independent of the loop above.
