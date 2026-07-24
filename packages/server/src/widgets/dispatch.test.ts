import { defineWidgetBrowserTasks } from '@shared/widgets/browser-contracts'
import {
  BrowserAutomationDeadlineError,
  BrowserAutomationProtocolError,
  BrowserAutomationUnavailableError,
  BrowserTaskRejectedError,
} from '@shared/widgets/browser-errors'
import {
  defineWidgetServer,
  toRuntimeWidgetServerDefinition,
  type RuntimeWidgetServerDefinition,
} from '@shared/widgets/contracts'
import { PublicWidgetError } from '@shared/widgets/public-error'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import type { BrowserAutomationClientResult } from '../browser/client'
import { makeFakeBrowserAutomationClient } from '../browser/testing/fake-client'
import { createMemoryOps, createMemoryPubSub } from '../test/memory-ops'
import { dispatchWidgetEvent, type DispatchWidgetEventOptions } from './dispatch'
import {
  InvalidWidgetPayloadError,
  InvalidWidgetResultError,
  UnknownWidgetEventError,
  UnknownWidgetTypeError,
  WidgetHandlerError,
} from './errors'
import { createWidgetServerRegistry } from './registry'

const browserTasks = defineWidgetBrowserTasks({
  check: {
    payload: z.object({ value: z.string() }),
    result: z.object({ echoed: z.string() }),
  },
})

const schemas = {
  echo: {
    payload: z.object({ value: z.string() }),
    result: z.object({ echoed: z.string(), instanceId: z.string() }),
  },
  browserStatus: {
    payload: z.object({ value: z.string() }),
    result: z.object({ kind: z.string(), code: z.string().nullable() }),
  },
  publicReject: {
    payload: z.object({}),
    result: z.object({ ok: z.boolean() }),
  },
  publicThrow: {
    payload: z.object({}),
    result: z.object({ ok: z.boolean() }),
  },
} as const

const definition = defineWidgetServer({
  schemas,
  handlers: {
    echo(payload, context) {
      return { echoed: payload.value, instanceId: context.instanceId }
    },
    async browserStatus(payload, context) {
      const result = await context.api.browser.invoke(browserTasks.check, payload)
      if (result instanceof BrowserTaskRejectedError) {
        return { kind: result._tag, code: String(result.code) }
      }
      if (result instanceof Error) return { kind: result._tag, code: null }
      return { kind: 'success', code: null }
    },
    publicReject() {
      return new PublicWidgetError({
        status: 409,
        code: 'browser_session_required',
        publicMessage: 'The browser session requires attention',
        meta: { sshTarget: 'admin@pi' },
      })
    },
    async publicThrow(): Promise<{ ok: boolean }> {
      throw new PublicWidgetError({ code: 'x', publicMessage: 'x' })
    },
  },
})

function createRegistry(definitions: RuntimeWidgetServerDefinition[]) {
  const registry = createWidgetServerRegistry(definitions)
  if (registry instanceof Error) throw registry
  return registry
}

const createdRegistry = createRegistry([
  toRuntimeWidgetServerDefinition({ typeId: 'test-widget', definition }),
])

const invalidResultDefinition: RuntimeWidgetServerDefinition = {
  typeId: 'invalid-result',
  schemas,
  handlers: {
    echo: () => ({ echoed: 1, instanceId: 'placement-1' }),
  },
}
const invalidResultRegistry = createRegistry([invalidResultDefinition])

const failingDefinition: RuntimeWidgetServerDefinition = {
  typeId: 'failing-widget',
  schemas,
  handlers: {
    echo: () => new Error('handler failed'),
  },
}
const failingRegistry = createRegistry([failingDefinition])

type DispatchTestOverrides = Partial<DispatchWidgetEventOptions> & {
  browserResult?: BrowserAutomationClientResult
}

function dispatch(overrides: DispatchTestOverrides = {}) {
  const { browserResult, ...dispatchOverrides } = overrides
  const pubsub = createMemoryPubSub()
  const browserFake = makeFakeBrowserAutomationClient()
  if (browserResult !== undefined) browserFake.setResult(browserResult)

  return dispatchWidgetEvent({
    registry: createdRegistry,
    ops: createMemoryOps(pubsub),
    browserClient: browserFake.client,
    typeId: 'test-widget',
    event: 'echo',
    instanceId: 'placement-1',
    payload: { value: 'ok' },
    ip: '127.0.0.1',
    now: () => 100,
    ...dispatchOverrides,
  })
}

describe('dispatchWidgetEvent', () => {
  it('returns an error for an unknown widget', async () => {
    expect(await dispatch({ typeId: 'missing' })).toBeInstanceOf(UnknownWidgetTypeError)
  })

  it('returns an error for an unknown event', async () => {
    expect(await dispatch({ event: 'missing' })).toBeInstanceOf(UnknownWidgetEventError)
  })

  it('validates the event payload', async () => {
    expect(await dispatch({ payload: { value: 1 } })).toBeInstanceOf(InvalidWidgetPayloadError)
  })

  it('returns a validated handler result', async () => {
    expect(await dispatch()).toEqual({
      data: { echoed: 'ok', instanceId: 'placement-1' },
    })
  })

  it('rejects a handler result that does not match its schema', async () => {
    expect(
      await dispatch({ registry: invalidResultRegistry, typeId: 'invalid-result' }),
    ).toBeInstanceOf(InvalidWidgetResultError)
  })

  it('wraps errors returned by handlers', async () => {
    expect(await dispatch({ registry: failingRegistry, typeId: 'failing-widget' })).toBeInstanceOf(
      WidgetHandlerError,
    )
  })

  it('returns a PublicWidgetError from a handler unchanged', async () => {
    const result = await dispatch({ event: 'publicReject', payload: {} })

    expect(result).toBeInstanceOf(PublicWidgetError)
    if (!(result instanceof PublicWidgetError)) throw new Error('expected PublicWidgetError')
    expect(result.status).toBe(409)
    expect(result.code).toBe('browser_session_required')
    expect(result.publicMessage).toBe('The browser session requires attention')
    expect(result.meta).toEqual({ sshTarget: 'admin@pi' })
  })

  it('still wraps a thrown PublicWidgetError as WidgetHandlerError', async () => {
    // Passthrough is a return-value contract (errore style); throwing stays internal.
    const result = await dispatch({ event: 'publicThrow', payload: {} })
    expect(result).toBeInstanceOf(WidgetHandlerError)
  })

  it.each([
    new BrowserAutomationUnavailableError({ operation: 'fetch' }),
    new BrowserAutomationDeadlineError({ timeoutMs: 100_000 }),
    new BrowserAutomationProtocolError({
      phase: 'envelope',
      widgetId: 'test-widget',
      taskId: 'check',
    }),
    new BrowserTaskRejectedError({
      widgetId: 'test-widget',
      taskId: 'check',
      code: 'browser_session_required',
      publicMessage: 'Browser attention is required',
    }),
  ])('delivers $name to the widget handler', async (error) => {
    const result = await dispatch({ event: 'browserStatus', browserResult: error })
    expect(result).toEqual({
      data: {
        kind: error._tag,
        code: error instanceof BrowserTaskRejectedError ? error.code : null,
      },
    })
  })
})
