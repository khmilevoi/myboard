import {
  defineWidgetBrowser,
  toRuntimeWidgetBrowserDefinition,
} from '@shared/widgets/browser-contracts'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import {
  BrowserExecutorError,
  BrowserServiceUnavailableError,
  BrowserTaskError,
  UnknownBrowserTaskError,
} from './errors'
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

  it('logs an executor failure in full, cause chain included', async () => {
    const { executor, state } = makeFakeExecutor()
    const warn = vi.fn()
    // Acquire runs before the handler, so it never sees the payload or the
    // widget secrets: its cause chain is Chromium launch detail only.
    const cause = new Error('SingletonLock: chromium is already running')
    state.acquireError = cause
    const service = makeBrowserService({
      registry: registryWith((p) => ({ echoed: p.value })),
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
    expect(outcome).toBeInstanceOf(BrowserExecutorError)
    expect(warn).toHaveBeenCalledWith('[browser-automation] task failed', {
      widgetId: 'demo',
      taskId: 'check',
      code: 'internal',
      error: outcome,
    })
    // The launch detail has to survive serialisation, or the container log
    // still shows a bare `internal` and the failure stays invisible.
    const [, fields] = warn.mock.calls[0]
    expect(JSON.stringify(fields)).toContain('SingletonLock')
    // Only the log carries the cause; `toEnvelopeError` still answers the
    // client with the redacted `internal` code (see errors.test.ts).
    const logged = (fields as { error: Error }).error
    expect(logged.cause).toBe(cause)
  })

  it('keeps handler-failure cause text out of the logged payload', async () => {
    const { executor } = makeFakeExecutor()
    const warn = vi.fn()
    // Playwright quotes `page.evaluate` arguments into its error messages, and
    // the passport widget passes the secret identity as one.
    const secret = '{"series":"AB","number":"123456"}'
    const service = makeBrowserService({
      registry: registryWith(() => {
        throw new Error(`page.evaluate failed: ${secret}`)
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

    // The leak is real: serialising the outcome itself exposes the identity,
    // via both `cause.message` and the wrapper's own `Caused by:` stack.
    expect(JSON.stringify(outcome)).toContain('123456')

    const [message, fields] = warn.mock.calls[0]
    expect(message).toBe('[browser-automation] task failed')
    expect(fields).toMatchObject({ widgetId: 'demo', taskId: 'check', code: 'internal' })

    const serialised = JSON.stringify(fields)
    expect(serialised).not.toContain('123456')
    expect(serialised).not.toContain('series')
    expect(serialised).not.toContain('page.evaluate')
    // Redacted does not mean useless: the failure is still identifiable.
    expect(serialised).toContain('BrowserTaskHandlerError')
  })
})
