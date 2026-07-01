import type { z } from 'zod'

export type WidgetEventSchemas = Record<
  string,
  {
    payload: z.ZodType
    result: z.ZodType
  }
>

export type WidgetEventMap = Record<
  string,
  {
    payload: unknown
    result: unknown
  }
>

export type InferWidgetEvents<Schemas extends WidgetEventSchemas> = {
  [Event in keyof Schemas]: {
    payload: z.input<Schemas[Event]['payload']>
    result: z.output<Schemas[Event]['result']>
  }
}

export type WidgetApi<Events extends WidgetEventMap, ApiError extends Error = Error> = {
  invoke<Event extends keyof Events & string>(
    event: Event,
    payload: Events[Event]['payload'],
  ): Promise<ApiError | Events[Event]['result']>
}

export type WidgetServerStorage = {
  get<T>(key: string, schema?: z.ZodType<T>): Promise<Error | T | null>
  set<T>(key: string, value: T, options?: { ttlMs?: number }): Promise<Error | void>
  delete(key: string): Promise<Error | void>
  has(key: string): Promise<Error | boolean>
  keys(prefix?: string): Promise<Error | string[]>
  append<T extends Record<string, unknown>>(
    key: string,
    entry: T,
    options?: { cap?: number },
  ): Promise<Error | void>
}

export type WidgetServerContext = {
  typeId: string
  instanceId: string
  ip: string | null
  now: () => number
  api: {
    storage: {
      instance: WidgetServerStorage
      shared: WidgetServerStorage
    }
  }
}

type Awaitable<T> = T | Promise<T>

export type WidgetServerDefinition<Schemas extends WidgetEventSchemas> = {
  typeId: string
  schemas: Schemas
  handlers: {
    [Event in keyof Schemas]: (
      payload: z.output<Schemas[Event]['payload']>,
      context: WidgetServerContext,
    ) => Awaitable<Error | z.input<Schemas[Event]['result']>>
  }
}

export type RuntimeWidgetServerDefinition = {
  typeId: string
  schemas: WidgetEventSchemas
  handlers: Record<
    string,
    (payload: unknown, context: WidgetServerContext) => Awaitable<Error | unknown>
  >
}

export function defineWidgetServer<const Schemas extends WidgetEventSchemas>(
  definition: WidgetServerDefinition<Schemas>,
): WidgetServerDefinition<Schemas> {
  return definition
}

export function toRuntimeWidgetServerDefinition<const Schemas extends WidgetEventSchemas>(
  definition: WidgetServerDefinition<Schemas>,
): RuntimeWidgetServerDefinition {
  return definition as unknown as RuntimeWidgetServerDefinition
}
