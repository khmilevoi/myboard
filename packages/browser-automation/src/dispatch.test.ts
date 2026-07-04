import {
  defineWidgetBrowser,
  toRuntimeWidgetBrowserDefinition,
} from '@shared/widgets/browser-contracts'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { dispatchBrowserTask } from './dispatch'
import {
  BrowserExecutorError,
  BrowserTaskError,
  BrowserTaskHandlerError,
  InvalidBrowserPayloadError,
  InvalidBrowserResultError,
  UnknownBrowserTaskError,
} from './errors'
import { makeWidgetBrowserRegistry, type WidgetBrowserRegistry } from './tasks/registry'
import { makeFakeExecutor, type FakeContext } from './testing/fake-executor'

class SessionRequiredError extends BrowserTaskError {
  code = 'session_required'
  publicMessage = 'Session required'
}

type Handler = (payload: { value: string }) => unknown

function registryWith(handler: Handler): WidgetBrowserRegistry<FakeContext> {
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

const base = { widgetId: 'demo', taskId: 'check', signal: new AbortController().signal }

describe('dispatchBrowserTask', () => {
  it('returns UnknownBrowserTaskError for a missing task', async () => {
    const { executor } = makeFakeExecutor()
    const result = await dispatchBrowserTask({
      registry: registryWith((p) => ({ echoed: p.value })),
      executor,
      widgetId: 'demo',
      taskId: 'nope',
      payload: {},
      signal: base.signal,
    })
    expect(result).toBeInstanceOf(UnknownBrowserTaskError)
  })

  it('returns InvalidBrowserPayloadError for a bad payload', async () => {
    const { executor } = makeFakeExecutor()
    const result = await dispatchBrowserTask({
      ...base,
      registry: registryWith((p) => ({ echoed: p.value })),
      executor,
      payload: { value: 123 },
    })
    expect(result).toBeInstanceOf(InvalidBrowserPayloadError)
  })

  it('validates the handler result', async () => {
    const { executor } = makeFakeExecutor()
    const result = await dispatchBrowserTask({
      ...base,
      registry: registryWith(() => ({ wrong: true })),
      executor,
      payload: { value: 'x' },
    })
    expect(result).toBeInstanceOf(InvalidBrowserResultError)
  })

  it('propagates a handler-returned public browser error', async () => {
    const { executor } = makeFakeExecutor()
    const result = await dispatchBrowserTask({
      ...base,
      registry: registryWith(() => new SessionRequiredError()),
      executor,
      payload: { value: 'x' },
    })
    expect(result).toBeInstanceOf(SessionRequiredError)
  })

  it('wraps a thrown handler error as internal', async () => {
    const { executor } = makeFakeExecutor()
    const result = await dispatchBrowserTask({
      ...base,
      registry: registryWith(() => {
        throw new Error('boom')
      }),
      executor,
      payload: { value: 'x' },
    })
    expect(result).toBeInstanceOf(BrowserTaskHandlerError)
  })

  it('returns BrowserExecutorError when acquire fails', async () => {
    const { executor, state } = makeFakeExecutor()
    state.acquireError = new Error('no browser')
    const result = await dispatchBrowserTask({
      ...base,
      registry: registryWith((p) => ({ echoed: p.value })),
      executor,
      payload: { value: 'x' },
    })
    expect(result).toBeInstanceOf(BrowserExecutorError)
  })

  it('returns the validated result, passes the signal, and releases the context', async () => {
    const { executor, state } = makeFakeExecutor()
    const controller = new AbortController()
    const result = await dispatchBrowserTask({
      registry: registryWith((p) => ({ echoed: p.value })),
      executor,
      widgetId: 'demo',
      taskId: 'check',
      payload: { value: 'hi' },
      signal: controller.signal,
    })
    expect(result).toEqual({ echoed: 'hi' })
    expect(state.lastSignal).toBe(controller.signal)
    expect(state.released).toBe(1)
  })

  it('passes the widgetId to the executor acquire', async () => {
    const { executor, state } = makeFakeExecutor()
    await dispatchBrowserTask({
      ...base,
      registry: registryWith((p) => ({ echoed: p.value })),
      executor,
      payload: { value: 'hi' },
    })
    expect(state.lastWidgetId).toBe('demo')
  })
})
