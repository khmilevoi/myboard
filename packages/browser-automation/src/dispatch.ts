import {
  BrowserExecutorError,
  BrowserTaskError,
  BrowserTaskHandlerError,
  InvalidBrowserPayloadError,
  InvalidBrowserResultError,
  UnknownBrowserTaskError,
} from './errors'
import type { BrowserExecutor } from './executor'
import type { WidgetBrowserRegistry } from './tasks/registry'

export type DispatchArgs<Context> = {
  registry: WidgetBrowserRegistry<Context>
  executor: BrowserExecutor<Context>
  widgetId: string
  taskId: string
  payload: unknown
  signal: AbortSignal
}

export async function dispatchBrowserTask<Context>(args: DispatchArgs<Context>) {
  const task = args.registry.get(args.widgetId)?.get(args.taskId)
  if (!task) return new UnknownBrowserTaskError({ widgetId: args.widgetId, taskId: args.taskId })

  const payload = task.payloadSchema.safeParse(args.payload)
  if (!payload.success) {
    return new InvalidBrowserPayloadError({
      widgetId: args.widgetId,
      taskId: args.taskId,
      cause: payload.error,
    })
  }

  const acquired = await args.executor
    .acquire(args.signal, args.widgetId)
    .catch((cause: unknown) => (cause instanceof Error ? cause : new Error(String(cause))))
  if (acquired instanceof Error) {
    return new BrowserExecutorError({
      widgetId: args.widgetId,
      taskId: args.taskId,
      cause: acquired,
    })
  }
  const context = acquired

  let handlerResult: unknown
  try {
    handlerResult = await task.handler(payload.data, context)
  } catch (cause) {
    handlerResult = new BrowserTaskHandlerError({
      widgetId: args.widgetId,
      taskId: args.taskId,
      cause,
    })
  }

  const released = await args.executor
    .release(context)
    .catch((cause) => new Error('release failed', { cause }))
  if (released instanceof Error) console.warn('[browser-automation] context release failed')

  if (handlerResult instanceof BrowserTaskError) return handlerResult
  if (handlerResult instanceof Error) {
    return new BrowserTaskHandlerError({
      widgetId: args.widgetId,
      taskId: args.taskId,
      cause: handlerResult,
    })
  }

  const result = task.resultSchema.safeParse(handlerResult)
  if (!result.success) {
    return new InvalidBrowserResultError({
      widgetId: args.widgetId,
      taskId: args.taskId,
      cause: result.error,
    })
  }
  return result.data
}
