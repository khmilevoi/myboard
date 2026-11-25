import type { ModuleScope } from '@shared/modules/contracts'
import type { WidgetEventSchemas } from '@shared/widgets/contracts'
import * as errore from 'errore'

import type { AnyModuleRef, ModuleContext, ModuleRef } from './define-module'

export class ModuleAccessError extends errore.createTaggedError({
  name: 'ModuleAccessError',
  message: 'Widget did not declare module $moduleId',
}) {}

export class ModuleLoadError extends errore.createTaggedError({
  name: 'ModuleLoadError',
  message: 'Module $moduleId failed to load',
}) {}

export type WidgetModules = {
  get<Actions extends WidgetEventSchemas, Scopes extends ModuleScope, Model>(
    module: ModuleRef<Actions, Scopes, Model>,
  ): Promise<ModuleAccessError | ModuleLoadError | Model>
}

export type ModuleRegistry = {
  forWidget(declared: readonly string[]): WidgetModules
}

export type ModuleRegistryDeps = {
  makeContext(module: AnyModuleRef): ModuleContext<WidgetEventSchemas, ModuleScope>
}

/**
 * One model per module id for the registry's whole life (the runtime's). Concurrent first calls
 * share one load; a failed load is evicted so the next call retries.
 */
export function makeModuleRegistry({ makeContext }: ModuleRegistryDeps): ModuleRegistry {
  const cache = new Map<string, Promise<ModuleLoadError | unknown>>()

  const load = (module: AnyModuleRef): Promise<ModuleLoadError | unknown> => {
    const context = makeContext(module)
    const loadModel = module.loadModel
    if (!loadModel) return Promise.resolve({ api: context.api })
    return loadModel()
      .then((factory) => factory(context))
      .catch((cause: unknown) => new ModuleLoadError({ moduleId: module.id, cause }))
  }

  const resolve = (module: AnyModuleRef) => {
    const cached = cache.get(module.id)
    if (cached) return cached
    const pending = load(module)
    cache.set(module.id, pending)
    // Registered before any caller's derived promise, so the entry is gone by the time a
    // caller sees the ModuleLoadError and can retry.
    void pending.then((result) => {
      if (result instanceof ModuleLoadError && cache.get(module.id) === pending) {
        cache.delete(module.id)
      }
    })
    return pending
  }

  return {
    forWidget(declared) {
      return {
        get<Actions extends WidgetEventSchemas, Scopes extends ModuleScope, Model>(
          module: ModuleRef<Actions, Scopes, Model>,
        ) {
          if (!declared.includes(module.id)) {
            return Promise.resolve(new ModuleAccessError({ moduleId: module.id }))
          }
          const cached = resolve(module as unknown as AnyModuleRef) as Promise<
            ModuleLoadError | Model
          >
          // Never hand out the cached promise itself: React's lazy()/use() brand a resolved
          // thenable in place, and a later consumer of the same branded object can livelock.
          return cached.then((model) => model)
        },
      }
    },
  }
}
