import { defineModuleServer, toRuntimeModuleServerDefinition } from '@shared/modules/contracts'
import type { WidgetViewer } from '@shared/widgets/contracts'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createMemoryOps, createMemoryPubSub } from '../test/memory-ops'
import { dispatchModuleAction } from './dispatch'
import { InvalidModuleResultError, ModuleAccountRequiredError, ModuleHandlerError } from './errors'
import { makeModuleServerRegistry } from './registry'

const actions = {
  boom: { payload: z.object({}), result: z.object({}) },
  bad: { payload: z.object({}), result: z.object({ n: z.number() }) },
}

function setup() {
  const handler = vi.fn((): Record<string, never> => ({}))
  const definition = defineModuleServer(
    { scopes: ['account'], actions },
    {
      handlers: {
        boom: handler,
        bad: () => ({ n: 'x' }) as unknown as { n: number },
      },
    },
  )
  const registry = makeModuleServerRegistry([
    toRuntimeModuleServerDefinition({ moduleId: 'm', definition }),
  ])
  if (registry instanceof Error) throw registry
  return { registry, handler, ops: createMemoryOps(createMemoryPubSub()) }
}

const viewer = { accountId: 'acc' } as unknown as WidgetViewer

describe('dispatchModuleAction', () => {
  it('refuses an account module without a viewer before the handler', async () => {
    const { registry, handler, ops } = setup()
    const result = await dispatchModuleAction({
      registry,
      ops,
      moduleId: 'm',
      action: 'boom',
      payload: {},
      viewer: null,
      now: () => 1,
    })
    expect(result).toBeInstanceOf(ModuleAccountRequiredError)
    expect(handler).not.toHaveBeenCalled()
  })

  it('wraps a thrown handler error as ModuleHandlerError', async () => {
    const { registry, handler, ops } = setup()
    handler.mockImplementation(() => {
      throw new Error('x')
    })
    const result = await dispatchModuleAction({
      registry,
      ops,
      moduleId: 'm',
      action: 'boom',
      payload: {},
      viewer,
      now: () => 1,
    })
    expect(result).toBeInstanceOf(ModuleHandlerError)
  })

  it('rejects a result that breaks the contract', async () => {
    const { registry, ops } = setup()
    const result = await dispatchModuleAction({
      registry,
      ops,
      moduleId: 'm',
      action: 'bad',
      payload: {},
      viewer,
      now: () => 1,
    })
    expect(result).toBeInstanceOf(InvalidModuleResultError)
  })
})
