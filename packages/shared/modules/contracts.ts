import type { z } from 'zod'

import type { WidgetEventSchemas, WidgetServerStorage, WidgetViewer } from '../widgets/contracts'

type Awaitable<T> = T | Promise<T>

export type ModuleScope = 'shared' | 'account'

export type ModuleContract<Actions extends WidgetEventSchemas, Scopes extends ModuleScope> = {
  scopes: readonly Scopes[]
  actions: Actions
}

export function defineModuleContract<
  const Actions extends WidgetEventSchemas,
  const Scopes extends ModuleScope,
>(contract: ModuleContract<Actions, Scopes>): ModuleContract<Actions, Scopes> {
  return contract
}

export type ModuleServerContext<Scopes extends ModuleScope> = {
  moduleId: string
  viewer: WidgetViewer | null
  now: () => number
  api: { storage: { [S in Scopes]: WidgetServerStorage } }
}

export type ModuleCronContext = {
  moduleId: string
  now: () => number
  /** The scheduled moment this run stands for, in epoch ms. */
  scheduledFor: number
  api: { storage: { shared: WidgetServerStorage } }
}

export type ModuleCronJob = {
  /** Cron expression, 5 or 6 fields (croner syntax). */
  schedule: string
  /** IANA time zone the expression is evaluated in. */
  timeZone: string
  run: (context: ModuleCronContext) => Awaitable<Error | void>
}

export type ModuleServerDefinition<
  Actions extends WidgetEventSchemas,
  Scopes extends ModuleScope,
> = {
  contract: ModuleContract<Actions, Scopes>
  handlers: {
    [A in keyof Actions]: (
      payload: z.output<Actions[A]['payload']>,
      context: ModuleServerContext<Scopes>,
    ) => Awaitable<Error | z.input<Actions[A]['result']>>
  }
  crons?: Record<string, ModuleCronJob>
}

export type RuntimeModuleServerDefinition = {
  moduleId: string
  scopes: readonly ModuleScope[]
  actions: WidgetEventSchemas
  handlers: Record<
    string,
    (payload: unknown, context: ModuleServerContext<ModuleScope>) => Awaitable<Error | unknown>
  >
  crons: Record<string, ModuleCronJob>
}

export function defineModuleServer<
  const Actions extends WidgetEventSchemas,
  const Scopes extends ModuleScope,
>(
  contract: ModuleContract<Actions, Scopes>,
  server: {
    handlers: ModuleServerDefinition<Actions, Scopes>['handlers']
    crons?: Record<string, ModuleCronJob>
  },
): ModuleServerDefinition<Actions, Scopes> {
  return { contract, handlers: server.handlers, crons: server.crons }
}

export function toRuntimeModuleServerDefinition<
  const Actions extends WidgetEventSchemas,
  const Scopes extends ModuleScope,
>({
  moduleId,
  definition,
}: {
  moduleId: string
  definition: ModuleServerDefinition<Actions, Scopes>
}): RuntimeModuleServerDefinition {
  return {
    moduleId,
    scopes: definition.contract.scopes,
    actions: definition.contract.actions,
    handlers: definition.handlers,
    crons: definition.crons ?? {},
  } as unknown as RuntimeModuleServerDefinition
}
