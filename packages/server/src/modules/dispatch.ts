import type { ModuleServerContext } from '@shared/modules/contracts'
import type { WidgetViewer } from '@shared/widgets/contracts'
import { PublicWidgetError } from '@shared/widgets/public-error'

import type { ValkeyOps } from '../storage/valkey'
import type { PublicWidgetDispatchError } from '../widgets/errors'
import { makeModuleServerStorage } from './api'
import {
  InvalidModulePayloadError,
  InvalidModuleResultError,
  ModuleAccountRequiredError,
  ModuleHandlerError,
  UnknownModuleActionError,
} from './errors'
import { findModuleServer, type ModuleServerRegistry } from './registry'

export type DispatchModuleActionOptions = {
  registry: ModuleServerRegistry
  ops: ValkeyOps
  moduleId: string
  action: string
  payload: unknown
  viewer: WidgetViewer | null
  now: () => number
}

export type ModuleDispatchSuccess = { data: unknown }

export async function dispatchModuleAction(
  options: DispatchModuleActionOptions,
): Promise<PublicWidgetDispatchError | ModuleDispatchSuccess> {
  const { moduleId, action, viewer } = options
  const definition = findModuleServer(options.registry, moduleId)
  if (definition instanceof Error) return definition

  const schema = definition.actions[action]
  const handler = definition.handlers[action]
  if (!Object.hasOwn(definition.actions, action) || !schema) {
    return new UnknownModuleActionError({ moduleId, action })
  }
  if (!Object.hasOwn(definition.handlers, action) || !handler) {
    return new UnknownModuleActionError({ moduleId, action })
  }

  const payload = schema.payload.safeParse(options.payload)
  if (!payload.success) {
    return new InvalidModulePayloadError({ moduleId, action, cause: payload.error })
  }

  // Refused here, not in the storage: a handler must never run half-authenticated.
  if (definition.scopes.includes('account') && viewer === null) {
    return new ModuleAccountRequiredError({ moduleId, action })
  }

  const context = {
    moduleId,
    viewer,
    now: options.now,
    api: {
      storage: makeModuleServerStorage({
        ops: options.ops,
        moduleId,
        scopes: definition.scopes,
        viewer,
        now: options.now,
      }),
    },
  } as unknown as ModuleServerContext<'shared' | 'account'>

  const handlerResult = await (async () => handler(payload.data, context))().catch(
    (cause) => new ModuleHandlerError({ moduleId, action, cause }),
  )
  if (handlerResult instanceof ModuleHandlerError) return handlerResult
  if (handlerResult instanceof PublicWidgetError) return handlerResult
  if (handlerResult instanceof Error) {
    return new ModuleHandlerError({ moduleId, action, cause: handlerResult })
  }

  const result = schema.result.safeParse(handlerResult)
  if (!result.success) {
    return new InvalidModuleResultError({ moduleId, action, cause: result.error })
  }

  return { data: result.data }
}
