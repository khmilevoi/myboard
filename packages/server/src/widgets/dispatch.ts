import type { WidgetServerContext } from '@shared/widgets/contracts'

import type { ValkeyOps } from '../storage/valkey'
import {
  InvalidWidgetPayloadError,
  InvalidWidgetResultError,
  UnknownWidgetEventError,
  WidgetHandlerError,
  type PublicWidgetDispatchError,
} from './errors'
import { findWidgetServer, type WidgetServerRegistry } from './registry'
import { createWidgetServerStorageApi } from './storage'

export type DispatchWidgetEventOptions = {
  registry: WidgetServerRegistry
  ops: ValkeyOps
  typeId: string
  event: string
  instanceId: string
  payload: unknown
  ip: string | null
  now: () => number
}

export type WidgetDispatchSuccess = { data: unknown }

export async function dispatchWidgetEvent(
  options: DispatchWidgetEventOptions,
): Promise<PublicWidgetDispatchError | WidgetDispatchSuccess> {
  const definition = findWidgetServer(options.registry, options.typeId)
  if (definition instanceof Error) return definition

  const schema = definition.schemas[options.event]
  const handler = definition.handlers[options.event]
  if (!Object.hasOwn(definition.schemas, options.event) || !schema) {
    return new UnknownWidgetEventError({ typeId: options.typeId, event: options.event })
  }
  if (!Object.hasOwn(definition.handlers, options.event) || !handler) {
    return new UnknownWidgetEventError({ typeId: options.typeId, event: options.event })
  }

  const payload = schema.payload.safeParse(options.payload)
  if (!payload.success) {
    return new InvalidWidgetPayloadError({
      typeId: options.typeId,
      event: options.event,
      cause: payload.error,
    })
  }

  const context: WidgetServerContext = {
    typeId: options.typeId,
    instanceId: options.instanceId,
    ip: options.ip,
    now: options.now,
    api: {
      storage: createWidgetServerStorageApi({
        ops: options.ops,
        typeId: options.typeId,
        instanceId: options.instanceId,
        ip: options.ip,
        now: options.now,
      }),
    },
  }

  const handlerResult = await Promise.resolve(handler(payload.data, context)).catch(
    (cause) =>
      new WidgetHandlerError({
        typeId: options.typeId,
        event: options.event,
        cause,
      }),
  )
  if (handlerResult instanceof WidgetHandlerError) return handlerResult
  if (handlerResult instanceof Error) {
    return new WidgetHandlerError({
      typeId: options.typeId,
      event: options.event,
      cause: handlerResult,
    })
  }

  const result = schema.result.safeParse(handlerResult)
  if (!result.success) {
    return new InvalidWidgetResultError({
      typeId: options.typeId,
      event: options.event,
      cause: result.error,
    })
  }

  return { data: result.data }
}
