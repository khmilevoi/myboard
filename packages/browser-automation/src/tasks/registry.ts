import type {
  RuntimeWidgetBrowserDefinition,
  WidgetBrowserTaskSchemas,
} from '@shared/widgets/browser-contracts'
import * as errore from 'errore'
import type { z } from 'zod'

export class DuplicateWidgetBrowserTaskError extends errore.createTaggedError({
  name: 'DuplicateWidgetBrowserTaskError',
  message: 'Duplicate browser task $widgetId/$taskId',
}) {}

export type RuntimeWidgetBrowserTask<Context> = {
  widgetId: string
  taskId: string
  payloadSchema: z.ZodType
  resultSchema: z.ZodType
  handler: RuntimeWidgetBrowserDefinition<Context, WidgetBrowserTaskSchemas>['handlers'][string]
}

export type WidgetBrowserRegistry<Context> = ReadonlyMap<
  string,
  ReadonlyMap<string, RuntimeWidgetBrowserTask<Context>>
>

export function makeWidgetBrowserRegistry<Context>(
  definitions: readonly RuntimeWidgetBrowserDefinition<Context, WidgetBrowserTaskSchemas>[],
): DuplicateWidgetBrowserTaskError | WidgetBrowserRegistry<Context> {
  const registry = new Map<string, Map<string, RuntimeWidgetBrowserTask<Context>>>()

  for (const definition of definitions) {
    const tasks =
      registry.get(definition.widgetId) ?? new Map<string, RuntimeWidgetBrowserTask<Context>>()
    registry.set(definition.widgetId, tasks)

    for (const [taskId, schemas] of Object.entries(definition.schemas)) {
      if (tasks.has(taskId)) {
        return new DuplicateWidgetBrowserTaskError({
          widgetId: definition.widgetId,
          taskId,
        })
      }
      tasks.set(taskId, {
        widgetId: definition.widgetId,
        taskId,
        payloadSchema: schemas.payload,
        resultSchema: schemas.result,
        handler: definition.handlers[taskId],
      })
    }
  }

  return registry
}
