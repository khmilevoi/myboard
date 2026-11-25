import type { ModuleContract, ModuleScope } from '@shared/modules/contracts'
import type { WidgetEventSchemas } from '@shared/widgets/contracts'

import type { WidgetIdentity } from '../identity'
import type { ScopedStorage } from '../storage'
import type { ServerTime } from '../timer/server-time'
import type { ModuleApi } from './module-api'

export type { ModuleApi }

export type ModuleContext<Actions extends WidgetEventSchemas, Scopes extends ModuleScope> = {
  moduleId: string
  storage: { [S in Scopes]: ScopedStorage }
  api: ModuleApi<Actions>
  timer: ServerTime
  identity: WidgetIdentity
}

export type ModuleDefinition<
  Actions extends WidgetEventSchemas,
  Scopes extends ModuleScope,
  Model,
> = ModuleContract<Actions, Scopes> & {
  loadModel?: () => Promise<(context: ModuleContext<Actions, Scopes>) => Model>
}

export type ServerOnlyModel<Actions extends WidgetEventSchemas> = { api: ModuleApi<Actions> }

export function defineModule<
  const Actions extends WidgetEventSchemas,
  const Scopes extends ModuleScope,
  Model,
>(
  definition: ModuleContract<Actions, Scopes> & {
    loadModel: () => Promise<(context: ModuleContext<Actions, Scopes>) => Model>
  },
): ModuleDefinition<Actions, Scopes, Model>
export function defineModule<
  const Actions extends WidgetEventSchemas,
  const Scopes extends ModuleScope,
>(
  definition: ModuleContract<Actions, Scopes>,
): ModuleDefinition<Actions, Scopes, ServerOnlyModel<Actions>>
export function defineModule(
  definition: ModuleDefinition<WidgetEventSchemas, ModuleScope, unknown>,
) {
  return definition
}

export type ModuleRef<
  Actions extends WidgetEventSchemas,
  Scopes extends ModuleScope,
  Model,
> = ModuleDefinition<Actions, Scopes, Model> & { readonly id: string }

export type AnyModuleRef = ModuleRef<WidgetEventSchemas, ModuleScope, unknown>

export function bindModule<Actions extends WidgetEventSchemas, Scopes extends ModuleScope, Model>(
  id: string,
  definition: ModuleDefinition<Actions, Scopes, Model>,
): ModuleRef<Actions, Scopes, Model> {
  return { ...definition, id }
}
