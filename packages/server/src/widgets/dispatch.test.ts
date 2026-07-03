import {
  defineWidgetServer,
  toRuntimeWidgetServerDefinition,
  type RuntimeWidgetServerDefinition,
} from '@shared/widgets/contracts'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { createMemoryOps, createMemoryPubSub } from '../test/memory-ops'
import { dispatchWidgetEvent } from './dispatch'
import {
  InvalidWidgetPayloadError,
  InvalidWidgetResultError,
  UnknownWidgetEventError,
  UnknownWidgetTypeError,
  WidgetHandlerError,
} from './errors'
import { createWidgetServerRegistry } from './registry'

const schemas = {
  echo: {
    payload: z.object({ value: z.string() }),
    result: z.object({ echoed: z.string(), instanceId: z.string() }),
  },
} as const

const definition = defineWidgetServer({
  schemas,
  handlers: {
    echo(payload, context) {
      return { echoed: payload.value, instanceId: context.instanceId }
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

function dispatch(overrides: Partial<Parameters<typeof dispatchWidgetEvent>[0]> = {}) {
  const pubsub = createMemoryPubSub()
  return dispatchWidgetEvent({
    registry: createdRegistry,
    ops: createMemoryOps(pubsub),
    typeId: 'test-widget',
    event: 'echo',
    instanceId: 'placement-1',
    payload: { value: 'ok' },
    ip: '127.0.0.1',
    now: () => 100,
    ...overrides,
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
})
