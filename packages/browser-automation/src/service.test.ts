import {
  defineWidgetBrowser,
  toRuntimeWidgetBrowserDefinition,
} from '@shared/widgets/browser-contracts'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { BrowserServiceUnavailableError, BrowserTaskError, UnknownBrowserTaskError } from './errors'
import { makeBrowserService } from './service'
import { makeWidgetBrowserRegistry, type WidgetBrowserRegistry } from './tasks/registry'
import { makeFakeExecutor, type FakeContext } from './testing/fake-executor'

class SessionRequiredError extends BrowserTaskError {
  code = 'session_required'
  publicMessage = 'Session required'
}

function registryWith(
  handler: (payload: { value: string }) => unknown,
): WidgetBrowserRegistry<FakeContext> {
  const definition = defineWidgetBrowser<FakeContext>()({
    schemas: {
      check: { payload: z.object({ value: z.string() }), result: z.object({ echoed: z.string() }) },
    },
    handlers: { check: (payload) => handler(payload) as { echoed: string } },
  })
  const registry = makeWidgetBrowserRegistry([
    toRuntimeWidgetBrowserDefinition({ widgetId: 'demo', definition }),
  ])
  if (registry instanceof Error) throw registry
  return registry
}

const config = { queueWaitMs: 1000, executionMs: 1000 }

describe('makeBrowserService', () => {
  it('rejects invocations before markReady', async () => {
    const { executor } = makeFakeExecutor()
    const service = makeBrowserService({
      registry: registryWith((p) => ({ echoed: p.value })),
      executor,
      config,
    })
    const result = await service.invoke({
      widgetId: 'demo',
      taskId: 'check',
      payload: { value: 'x' },
    })
    expect(result).toBeInstanceOf(BrowserServiceUnavailableError)
  })

  it('runs a task after markReady', async () => {
    const { executor } = makeFakeExecutor()
    const service = makeBrowserService({
      registry: registryWith((p) => ({ echoed: p.value })),
      executor,
      config,
    })
    service.markReady()
    const result = await service.invoke({
      widgetId: 'demo',
      taskId: 'check',
      payload: { value: 'hi' },
    })
    expect(result).toEqual({ echoed: 'hi' })
  })

  it('returns a public error for an unknown task', async () => {
    const { executor } = makeFakeExecutor()
    const service = makeBrowserService({
      registry: registryWith((p) => ({ echoed: p.value })),
      executor,
      config,
    })
    service.markReady()
    const result = await service.invoke({ widgetId: 'demo', taskId: 'nope', payload: {} })
    expect(result).toBeInstanceOf(UnknownBrowserTaskError)
  })

  it('reports liveness transitions', async () => {
    const { executor } = makeFakeExecutor()
    const service = makeBrowserService({
      registry: registryWith((p) => ({ echoed: p.value })),
      executor,
      config,
    })
    expect(service.health()).toEqual({ status: 'starting', healthy: false })
    service.markReady()
    expect(service.health()).toEqual({ status: 'ready', healthy: true })
    await service.shutdown()
    expect(service.health()).toEqual({ status: 'draining', healthy: false })
  })

  it('keeps health ready when a task reports session-required', async () => {
    const { executor } = makeFakeExecutor()
    const service = makeBrowserService({
      registry: registryWith(() => new SessionRequiredError()),
      executor,
      config,
    })
    service.markReady()
    const result = await service.invoke({
      widgetId: 'demo',
      taskId: 'check',
      payload: { value: 'x' },
    })
    expect(result).toBeInstanceOf(SessionRequiredError)
    expect(service.health()).toEqual({ status: 'ready', healthy: true })
  })

  it('shuts the executor down exactly once and is idempotent', async () => {
    const { executor, state } = makeFakeExecutor()
    const service = makeBrowserService({
      registry: registryWith((p) => ({ echoed: p.value })),
      executor,
      config,
    })
    service.markReady()
    await service.shutdown()
    await service.shutdown()
    expect(state.shutdowns).toBe(1)
  })

  it('reports recovery state only while ready', () => {
    const { executor, state } = makeFakeExecutor()
    const service = makeBrowserService({
      registry: registryWith((p) => ({ echoed: p.value })),
      executor,
      config,
    })

    expect(service.recoveryState('demo')).toBeInstanceOf(BrowserServiceUnavailableError)

    service.markReady()
    expect(service.recoveryState('demo')).toEqual({ retained: false })

    state.retainedWidgetIds.add('demo')
    expect(service.recoveryState('demo')).toEqual({ retained: true })
  })

  it('logs the failing error with its cause chain for internal failures', async () => {
    const { executor } = makeFakeExecutor()
    const warn = vi.fn()
    const cause = new Error('launch failed')
    const service = makeBrowserService({
      registry: registryWith(() => {
        throw cause
      }),
      executor,
      config,
      logger: { warn },
    })
    service.markReady()
    const outcome = await service.invoke({
      widgetId: 'demo',
      taskId: 'check',
      payload: { value: 'x' },
    })
    expect(warn).toHaveBeenCalledWith('[browser-automation] task failed', {
      widgetId: 'demo',
      taskId: 'check',
      code: 'internal',
      error: outcome,
    })
    // Only the log carries the cause; `toEnvelopeError` still answers the
    // client with the redacted `internal` code (see errors.test.ts).
    const logged = (warn.mock.calls[0][1] as { error: Error }).error
    expect(logged.cause).toBe(cause)
  })
})
