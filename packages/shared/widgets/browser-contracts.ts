import type { z } from 'zod'

import type { BrowserGatewayError } from './browser-errors'
import type { InferWidgetEvents, WidgetEventSchemas } from './contracts'

export type WidgetBrowserTaskSchemas = WidgetEventSchemas

export type InferWidgetBrowserTasks<Schemas extends WidgetBrowserTaskSchemas> =
  InferWidgetEvents<Schemas>

type Awaitable<T> = T | Promise<T>

export type WidgetBrowserDefinition<Schemas extends WidgetBrowserTaskSchemas, Context> = {
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
    [Task in keyof Schemas]: (payload: unknown, context: Context) => Awaitable<Error | unknown>
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
  return { widgetId, ...definition } as unknown as RuntimeWidgetBrowserDefinition<Context, Schemas>
}

export type WidgetBrowserTaskDescriptor<
  Id extends string = string,
  PayloadSchema extends z.ZodType = z.ZodType,
  ResultSchema extends z.ZodType = z.ZodType,
> = {
  readonly id: Id
  readonly payload: PayloadSchema
  readonly result: ResultSchema
}

export type WidgetBrowserTaskDescriptors<Schemas extends WidgetBrowserTaskSchemas> = {
  readonly [Task in keyof Schemas & string]: WidgetBrowserTaskDescriptor<
    Task,
    Schemas[Task]['payload'],
    Schemas[Task]['result']
  >
}

export function defineWidgetBrowserTasks<const Schemas extends WidgetBrowserTaskSchemas>(
  schemas: Schemas,
): WidgetBrowserTaskDescriptors<Schemas> {
  return Object.fromEntries(
    Object.entries(schemas).map(([id, schema]) => [id, { id, ...schema }]),
  ) as WidgetBrowserTaskDescriptors<Schemas>
}

export type WidgetServerBrowserApi = {
  invoke<Id extends string, PayloadSchema extends z.ZodType, ResultSchema extends z.ZodType>(
    task: WidgetBrowserTaskDescriptor<Id, PayloadSchema, ResultSchema>,
    payload: z.input<PayloadSchema>,
  ): Promise<BrowserGatewayError | z.output<ResultSchema>>
}
