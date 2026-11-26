import type { ModuleScope } from '@shared/modules/contracts'
import type { WidgetEventSchemas } from '@shared/widgets/contracts'
import { describe, expect, it, vi } from 'vitest'

import { makeStaticWidgetIdentity } from '../identity'
import type { ScopedStorage } from '../storage'
import type { ServerTime } from '../timer/server-time'
import { type AnyModuleRef, bindModule, defineModule, type ModuleContext } from './define-module'
import { ModuleAccessError, ModuleLoadError, makeModuleRegistry } from './registry'

const makeContext = (module: AnyModuleRef): ModuleContext<WidgetEventSchemas, ModuleScope> => ({
  moduleId: module.id,
  storage: {} as { [S in ModuleScope]: ScopedStorage },
  api: { invoke: async () => null },
  timer: {} as ServerTime,
  identity: makeStaticWidgetIdentity(),
})

const notesModule = bindModule(
  'notes',
  defineModule({ scopes: ['shared'], actions: {}, loadModel: async () => () => ({ notes: [] }) }),
)

describe('makeModuleRegistry', () => {
  it('gives two widgets the same model instance', async () => {
    const registry = makeModuleRegistry({ makeContext })
    const a = await registry.forWidget(['notes']).get(notesModule)
    const b = await registry.forWidget(['notes']).get(notesModule)
    expect(a).toBe(b)
  })

  it('loads once for concurrent first calls and returns fresh promises', async () => {
    const factory = vi.fn((ctx: unknown) => ({ ctx }))
    const loadModel = vi.fn(async () => factory)
    const ref = bindModule('notes', { scopes: ['shared'], actions: {}, loadModel })
    const registry = makeModuleRegistry({ makeContext })
    const p1 = registry.forWidget(['notes']).get(ref)
    const p2 = registry.forWidget(['notes']).get(ref)
    expect(p1).not.toBe(p2)
    expect(await p1).toBe(await p2)
    expect(loadModel).toHaveBeenCalledTimes(1)
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('refuses an undeclared module', async () =>
    expect(await makeModuleRegistry({ makeContext }).forWidget([]).get(notesModule)).toBeInstanceOf(
      ModuleAccessError,
    ))

  it('reports a failed load and retries on the next call', async () => {
    const model = { notes: [] }
    const chunkError = new Error('chunk failed')
    const loadModel = vi
      .fn<() => Promise<(ctx: unknown) => typeof model>>()
      .mockRejectedValueOnce(chunkError)
      .mockResolvedValueOnce(() => model)
    const ref = bindModule('notes', { scopes: ['shared'], actions: {}, loadModel })
    const modules = makeModuleRegistry({ makeContext }).forWidget(['notes'])

    const failed = await modules.get(ref)
    expect(failed).toBeInstanceOf(ModuleLoadError)
    expect((failed as ModuleLoadError).cause).toBe(chunkError)

    expect(await modules.get(ref)).toBe(model)
    expect(loadModel).toHaveBeenCalledTimes(2)
  })

  it('turns a synchronous loadModel throw into a ModuleLoadError and retries later', async () => {
    const model = { notes: [] }
    const boom = new Error('sync boom')
    const loadModel = vi
      .fn<() => Promise<(ctx: unknown) => typeof model>>()
      .mockImplementationOnce(() => {
        throw boom
      })
      .mockResolvedValueOnce(() => model)
    const ref = bindModule('notes', { scopes: ['shared'], actions: {}, loadModel })
    const modules = makeModuleRegistry({ makeContext }).forWidget(['notes'])

    const failed = await modules.get(ref)
    expect(failed).toBeInstanceOf(ModuleLoadError)
    expect((failed as ModuleLoadError).cause).toBe(boom)

    expect(await modules.get(ref)).toBe(model)
    expect(loadModel).toHaveBeenCalledTimes(2)
  })

  it('serves a server-only module as { api }', async () => {
    const api = { invoke: async () => null }
    const ref = bindModule('pings', defineModule({ scopes: ['shared'], actions: {} }))
    const registry = makeModuleRegistry({
      makeContext: (module) => ({ ...makeContext(module), api }),
    })
    const model = await registry.forWidget(['pings']).get(ref)
    expect(model).toEqual({ api })
    expect((model as { api: unknown }).api).toBe(api)
  })
})
