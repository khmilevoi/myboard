import type { ModuleCronContext, ModuleScope } from '@shared/modules/contracts'
import { moduleAccountNamespace, moduleSharedNamespace } from '@shared/storage/scope'
import type { WidgetServerStorage, WidgetViewer } from '@shared/widgets/contracts'

import type { ValkeyOps } from '../storage/valkey'
import { makeAccountRequiredStorage, makeWidgetScopedStorage } from '../widgets/storage'

export type MakeModuleServerStorageOptions = {
  ops: ValkeyOps
  moduleId: string
  scopes: readonly ModuleScope[]
  viewer: WidgetViewer | null
  now: () => number
}

/** Only the declared scopes are present; `account` refuses when there is no session. */
export function makeModuleServerStorage({
  ops,
  moduleId,
  scopes,
  viewer,
  now,
}: MakeModuleServerStorageOptions): {
  shared?: WidgetServerStorage
  account?: WidgetServerStorage
} {
  const scope = (namespace: string) => makeWidgetScopedStorage({ ops, namespace, now })
  return {
    ...(scopes.includes('shared') && { shared: scope(moduleSharedNamespace(moduleId)) }),
    ...(scopes.includes('account') && {
      account: viewer
        ? scope(moduleAccountNamespace(moduleId, viewer.accountId))
        : makeAccountRequiredStorage(),
    }),
  }
}

export type MakeModuleCronApiOptions = {
  ops: ValkeyOps
  moduleId: string
  now: () => number
}

export function makeModuleCronApi({
  ops,
  moduleId,
  now,
}: MakeModuleCronApiOptions): ModuleCronContext['api'] {
  return {
    storage: {
      shared: makeWidgetScopedStorage({ ops, namespace: moduleSharedNamespace(moduleId), now }),
    },
  }
}
