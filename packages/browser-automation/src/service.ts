import { dispatchBrowserTask } from './dispatch'
import { BrowserServiceUnavailableError, BrowserTaskError } from './errors'
import type { BrowserExecutor } from './executor'
import { makeSingleLaneQueue } from './queue'
import type { WidgetBrowserRegistry } from './tasks/registry'

export type ServiceState = 'starting' | 'ready' | 'draining'

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
      logger.warn('[browser-automation] task failed', {
        widgetId: args.widgetId,
        taskId: args.taskId,
        code: outcome.code,
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
