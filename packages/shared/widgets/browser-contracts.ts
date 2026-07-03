import type { z } from 'zod'

import type { InferWidgetEvents, WidgetEventSchemas } from './contracts'

export type WidgetBrowserTaskSchemas = WidgetEventSchemas

export type InferWidgetBrowserTasks<Schemas extends WidgetBrowserTaskSchemas> =
  InferWidgetEvents<Schemas>

type Awaitable<T> = T | Promise<T>

export type WidgetBrowserDefinition<
  Schemas extends WidgetBrowserTaskSchemas,
  Context,
> = {
  schemas: Schemas
  handlers: {
    [Task in keyof Schemas]: (
      payload: z.output<Schemas[Task]['payload']>,
      context: Context,
    ) => Awaitable<Error | z.input<Schemas[Task]['result']>>
  }
}

export type RuntimeWidgetBrowserDefinition<
  Context,
  Schemas extends WidgetBrowserTaskSchemas = WidgetBrowserTaskSchemas,
> = {
  widgetId: string
  schemas: Schemas
  handlers: {
    [Task in keyof Schemas]: (
      payload: unknown,
      context: Context,
    ) => Awaitable<Error | unknown>
  }
}

export function defineWidgetBrowser<Context>() {
  return <const Schemas extends WidgetBrowserTaskSchemas>(
    definition: WidgetBrowserDefinition<Schemas, Context>,
  ) => definition
}

export function toRuntimeWidgetBrowserDefinition<
  const Schemas extends WidgetBrowserTaskSchemas,
  Context,
>({
  widgetId,
  definition,
}: {
  widgetId: string
  definition: WidgetBrowserDefinition<Schemas, Context>
}): RuntimeWidgetBrowserDefinition<Context, Schemas> {
  return { widgetId, ...definition } as unknown as RuntimeWidgetBrowserDefinition<
    Context,
    Schemas
  >
}
