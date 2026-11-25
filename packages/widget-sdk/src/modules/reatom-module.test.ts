import { context, wrap } from '@reatom/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModuleAccessError, ModuleLoadError, type WidgetModules } from 'widget-runtime'
import type { ModuleRef } from 'widget-runtime/define-module'

import { reatomModule } from './reatom-module'

type FakeModel = { label: string }

const fakeModule = { id: 'fake' } as unknown as ModuleRef<never, never, FakeModel>

function fakeModules(
  ...answers: (FakeModel | ModuleAccessError | ModuleLoadError)[]
): WidgetModules & { get: ReturnType<typeof vi.fn> } {
  const get = vi.fn()
  for (const answer of answers) get.mockResolvedValueOnce(answer)
  return { get } as unknown as WidgetModules & { get: ReturnType<typeof vi.fn> }
}

afterEach(() => {
  context.reset()
})

describe('reatomModule', () => {
  it('loads the model on first connect', async () => {
    const model: FakeModel = { label: 'ready' }
    const modules = fakeModules(model)
    const mod = reatomModule({ modules, module: fakeModule, name: 'test.module' })

    expect(modules.get).not.toHaveBeenCalled()
    expect(mod.model()).toBeNull()

    await context.start(async () => {
      const readModel = wrap(() => mod.model())
      const off = mod.model.subscribe(() => {})

      await vi.waitFor(() => expect(readModel()).toBe(model))
      expect(modules.get).toHaveBeenCalledOnce()
      expect(modules.get).toHaveBeenCalledWith(fakeModule)
      off()
    })
  })

  it('keeps the loaded model across a reconnect instead of loading again', async () => {
    const model: FakeModel = { label: 'ready' }
    const modules = fakeModules(model)
    const mod = reatomModule({ modules, module: fakeModule, name: 'test.module' })

    await context.start(async () => {
      const readModel = wrap(() => mod.model())
      const subscribe = wrap(() => mod.model.subscribe(() => {}))
      const off = subscribe()
      await vi.waitFor(() => expect(readModel()).toBe(model))
      off()

      const offAgain = subscribe()
      expect(readModel()).toBe(model)
      offAgain()
      expect(modules.get).toHaveBeenCalledOnce()
    })
  })

  it('surfaces a ModuleLoadError in error, and retry loads on the second attempt', async () => {
    const model: FakeModel = { label: 'second time lucky' }
    const failure = new ModuleLoadError({ moduleId: 'fake' })
    const modules = fakeModules(failure, model)
    const mod = reatomModule({ modules, module: fakeModule, name: 'test.module' })

    await context.start(async () => {
      const readModel = wrap(() => mod.model())
      const readError = wrap(() => mod.error())
      const retry = wrap(() => mod.retry())
      const off = mod.model.subscribe(() => {})

      await vi.waitFor(() => expect(readError()).toBe(failure))
      expect(readModel()).toBeNull()

      await retry()

      expect(readModel()).toBe(model)
      expect(readError()).toBeNull()
      expect(modules.get).toHaveBeenCalledTimes(2)
      off()
    })
  })

  it('surfaces a ModuleAccessError for an undeclared module', async () => {
    const failure = new ModuleAccessError({ moduleId: 'fake' })
    const modules = fakeModules(failure)
    const mod = reatomModule({ modules, module: fakeModule, name: 'test.module' })

    await context.start(async () => {
      const readError = wrap(() => mod.error())
      const off = mod.model.subscribe(() => {})

      await vi.waitFor(() => expect(readError()).toBe(failure))
      off()
    })
  })
})
