import { action, atom, withAsync, withConnectHook, wrap } from '@reatom/core'
import type { Action, Atom } from '@reatom/core'
import * as errore from 'errore'
import type { ModuleAccessError, ModuleLoadError, WidgetModules } from 'widget-runtime'
import type { ModuleRef } from 'widget-runtime/define-module'

export type ReatomModuleOptions<Model> = {
  modules: WidgetModules
  // oxlint-disable-next-line typescript/no-explicit-any -- any action/scope set; only Model matters here
  module: ModuleRef<any, any, Model>
  name: string
}

export type ReatomModule<Model> = {
  /** The module's model once loaded; null until then. Kept for the atom's whole life once set. */
  model: Atom<Model | null>
  /** Why the last load failed, or null. */
  error: Atom<ModuleAccessError | ModuleLoadError | null>
  /** Loads the module again — the way out of `error`. */
  retry: Action<[], Promise<void>>
}

/**
 * A widget's handle on one of its declared modules. The load starts when `model` first gains a
 * subscriber, and a loaded model is never dropped or reloaded.
 */
export function reatomModule<Model>({
  modules,
  module,
  name,
}: ReatomModuleOptions<Model>): ReatomModule<Model> {
  const model = atom<Model | null>(null, `${name}.model`)
  const error = atom<ModuleAccessError | ModuleLoadError | null>(null, `${name}.error`)

  // `modules.get` returns failures as values and never rejects; `await wrap(...)`
  // keeps the continuation in this action's frame, so the writes after it land
  // in the right context.
  const load = action(async () => {
    error.set(null)
    const result = await wrap(modules.get(module))
    if (result instanceof Error) {
      error.set(result)
      return
    }
    model.set(result)
  }, `${name}.load`).extend(withAsync())

  model.extend(
    withConnectHook(() => {
      if (model() !== null || load.pending() > 0) return
      // A disconnect mid-load aborts the connect frame; the next connect finds
      // `model` still null and starts over, so the abort itself is not a failure.
      void load().catch((cause: unknown) => {
        if (errore.isAbortError(cause)) return
        console.warn(`${name}: module load failed unexpectedly`, cause)
      })
    }),
  )

  return { model, error, retry: load }
}
