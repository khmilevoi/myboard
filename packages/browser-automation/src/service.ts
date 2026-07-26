import { dispatchBrowserTask } from './dispatch'
import { BrowserExecutorError, BrowserServiceUnavailableError, BrowserTaskError } from './errors'
import type { BrowserExecutor } from './executor'
import { makeSingleLaneQueue } from './queue'
import type { WidgetBrowserRegistry } from './tasks/registry'

export type ServiceState = 'starting' | 'ready' | 'draining'

// An error name is normally a class identifier. Nothing stops foreign code from
// putting free text there, so anything that is not identifier-shaped is dropped
// instead of logged.
const ERROR_NAME = /^[A-Za-z][A-Za-z0-9_$]{0,63}$/

/**
 * The names of an error and of every error in its `cause` chain — nothing else.
 * Deliberately omits `message`, `stack`, and any other property, because those
 * are where foreign error text (and with it task data) lives.
 */
function redactedErrorChain(error: Error) {
  const names: string[] = []
  const seen = new Set<unknown>()
  let current: unknown = error
  // `seen` breaks cyclic chains; the length bound keeps one log line bounded.
  while (current instanceof Error && !seen.has(current) && names.length < 16) {
    seen.add(current)
    names.push(ERROR_NAME.test(current.name) ? current.name : '<redacted>')
    current = current.cause
  }
  return names
}

export type BrowserService = {
  invoke(args: { widgetId: string; taskId: string; payload: unknown }): Promise<Error | unknown>
  health(): { status: ServiceState; healthy: boolean }
  recoveryState(widgetId: string): BrowserServiceUnavailableError | { retained: boolean }
  markReady(): void
  shutdown(): Promise<void>
}

export type BrowserServiceDeps<Context> = {
  registry: WidgetBrowserRegistry<Context>
  executor: BrowserExecutor<Context>
  config: { queueWaitMs: number; executionMs: number }
  logger?: { warn(message: string, fields: Record<string, unknown>): void }
}

export function makeBrowserService<Context>(deps: BrowserServiceDeps<Context>): BrowserService {
  const logger = deps.logger ?? {
    warn: (message: string, fields: Record<string, unknown>) => console.warn(message, fields),
  }
  const queue = makeSingleLaneQueue(deps.config)
  let state: ServiceState = 'starting'

  async function invoke(args: { widgetId: string; taskId: string; payload: unknown }) {
    if (state !== 'ready') return new BrowserServiceUnavailableError({ state })

    const outcome = await queue.enqueue((signal) =>
      dispatchBrowserTask({
        registry: deps.registry,
        executor: deps.executor,
        widgetId: args.widgetId,
        taskId: args.taskId,
        payload: args.payload,
        signal,
      }),
    )

    if (outcome instanceof BrowserTaskError && outcome.code === 'internal') {
      // `internal` is all the client is told, so something has to reach the
      // container log or the real failure is invisible. How much depends on
      // whether the error can have touched task data.
      //
      // `BrowserExecutorError` cannot: `dispatch.ts` raises it only when
      // `executor.acquire(...)` fails, and acquire runs before the handler and
      // is passed neither the payload nor the widget secrets, so its cause
      // chain is Chromium/Playwright launch detail only. That is also the
      // failure we could not previously diagnose (a stale Chromium singleton
      // lock), so it stays logged in full.
      //
      // Every other internal failure — `BrowserTaskHandlerError` above all —
      // wraps whatever the handler threw or returned. Playwright quotes
      // `page.evaluate` arguments into its messages, and the passport widget
      // passes the secret identity as one, so the cause `message`/`stack` can
      // carry it (the wrapper's own stack repeats it under `Caused by:`). The
      // design spec forbids logging that: see
      // docs/superpowers/specs/2026-07-03-passport-checker-browser-automation-design.md
      // :350-353 (raw Playwright/network/Zod detail is logged only after
      // redaction, bodies never) and :684 (logs redact payloads and secrets).
      // Those failures are reduced to their chain of error names.
      const detail =
        outcome instanceof BrowserExecutorError
          ? { error: outcome }
          : { errorChain: redactedErrorChain(outcome) }
      logger.warn('[browser-automation] task failed', {
        widgetId: args.widgetId,
        taskId: args.taskId,
        code: outcome.code,
        ...detail,
      })
    }
    return outcome
  }

  function health() {
    return { status: state, healthy: state === 'ready' }
  }

  function recoveryState(widgetId: string) {
    if (state !== 'ready') return new BrowserServiceUnavailableError({ state })
    // Deliberately not queued: the point is to inspect a page a finished task
    // left behind, which must stay answerable while the single lane is busy.
    return { retained: deps.executor.hasRetainedPage(widgetId) }
  }

  function markReady() {
    if (state === 'starting') state = 'ready'
  }

  async function shutdown() {
    if (state === 'draining') return
    state = 'draining'
    queue.close(() => new BrowserServiceUnavailableError({ state: 'draining' }))
    await queue.whenSettled()
    await deps.executor.shutdown()
  }

  return { invoke, health, recoveryState, markReady, shutdown }
}
