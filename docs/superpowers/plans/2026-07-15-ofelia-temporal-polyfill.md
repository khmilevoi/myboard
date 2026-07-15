# Ofelia Temporal Polyfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Ofelia widget load on iPhone/WebKit browsers that do not provide the native `Temporal` API.

**Architecture:** Keep the compatibility boundary in the Ofelia widget client loader. Before importing the UI module that evaluates `Temporal` at module scope, feature-detect `globalThis.Temporal`, dynamically import `@js-temporal/polyfill` only when needed, install its `Temporal` export on the global object, and then continue the existing lazy component import.

**Tech Stack:** TypeScript, React 19 lazy loading, Vite Module Federation, Vitest, `@js-temporal/polyfill`.

## Global Constraints

- Do not overwrite a native `Temporal` implementation.
- Do not load the polyfill for browsers that already provide `Temporal`.
- Keep the compatibility behavior local to the Ofelia widget so its standalone harness and federated host use the same loader.
- Preserve the existing `WidgetComponentModule` shape: `{ default: OfeliaPoopDuty }`.
- Do not create a git commit unless the user asks for one.

---

### Task 1: Load Ofelia safely without native Temporal

**Files:**

- Modify: `pnpm-workspace.yaml`
- Modify: `packages/widgets/ofelia-poop-duty/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `packages/widgets/ofelia-poop-duty/client.ts`
- Test: `packages/widgets/ofelia-poop-duty/client.test.ts`

**Interfaces:**

- Consumes: `@js-temporal/polyfill` named export `Temporal` and the existing `ofeliaWidget.loadComponent()` interface.
- Produces: an internal `ensureTemporal(): Promise<void>` compatibility guard and a loader that always imports `./ui/OfeliaPoopDuty` after `Temporal` is available.

- [ ] **Step 1: Add the failing loader regression test**

  Extend `client.test.ts` with an async test that saves the original `Temporal` property descriptor, deletes `globalThis.Temporal`, calls `ofeliaWidget.loadComponent()`, and asserts both `typeof globalThis.Temporal.PlainDate.from === 'function'` and that `module.default` is defined. Restore the original descriptor in `finally` so the shared test environment is not polluted.

- [ ] **Step 2: Run the targeted test and verify the missing-Temporal failure**

  Run `pnpm --filter widgets-ofelia-poop-duty test -- client.test.ts` from the repository root.

  Expected before implementation: FAIL because importing `model/ofelia-duty.ts` evaluates `Temporal.PlainDate.from(...)` while `Temporal` is absent.

- [ ] **Step 3: Add the polyfill dependency**

  Add `@js-temporal/polyfill` to the workspace catalog and to the Ofelia widget's production dependencies, then update the lockfile with `pnpm install --filter widgets-ofelia-poop-duty`.

- [ ] **Step 4: Implement the conditional compatibility guard**

  Add an internal async guard in `client.ts` with this behavior:

  ```ts
  async function ensureTemporal(): Promise<void> {
    if (typeof globalThis.Temporal !== 'undefined') return

    const { Temporal } = await import('@js-temporal/polyfill')
    Object.defineProperty(globalThis, 'Temporal', {
      configurable: true,
      writable: true,
      value: Temporal,
    })
  }
  ```

  Change `loadComponent` to await `ensureTemporal()` before dynamically importing `./ui/OfeliaPoopDuty`. Keep the current named-to-default module mapping.

- [ ] **Step 5: Run the focused regression test and widget typecheck**

  Run:

  ```text
  pnpm --filter widgets-ofelia-poop-duty test -- client.test.ts
  pnpm --filter widgets-ofelia-poop-duty typecheck
  ```

  Expected: both commands exit successfully.

- [ ] **Step 6: Run production build verification**

  Run `pnpm build` from the repository root.

  Expected: code generation, all widget builds, the client typecheck, and the client production build complete successfully.

- [ ] **Step 7: Re-run the reported iPhone/WebKit path**

  Serve the production client with `pnpm preview -- --host 127.0.0.1`, open it using Playwright WebKit with an iPhone device profile, add the widget named `Лоток Офелии`, and verify that the widget renders without `Can't find variable: Temporal` or React error #306 in the console.
