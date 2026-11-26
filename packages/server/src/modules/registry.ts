import type { RuntimeModuleServerDefinition } from '@shared/modules/contracts'

import { InvalidCronScheduleError } from '../widgets/errors'
import { tryParseCron } from '../widgets/registry'
import {
  DuplicateModuleError,
  ModuleCronWithoutSharedScopeError,
  UnknownModuleError,
} from './errors'

export type ModuleServerRegistry = ReadonlyMap<string, RuntimeModuleServerDefinition>

export function makeModuleServerRegistry(
  definitions: readonly RuntimeModuleServerDefinition[],
):
  | DuplicateModuleError
  | InvalidCronScheduleError
  | ModuleCronWithoutSharedScopeError
  | ModuleServerRegistry {
  const registry = new Map<string, RuntimeModuleServerDefinition>()
  for (const definition of definitions) {
    const { moduleId } = definition
    if (registry.has(moduleId)) return new DuplicateModuleError({ moduleId })

    const crons = Object.entries(definition.crons)
    if (crons.length > 0 && !definition.scopes.includes('shared')) {
      return new ModuleCronWithoutSharedScopeError({ moduleId })
    }
    for (const [job, cron] of crons) {
      const parsed = tryParseCron(cron.schedule, cron.timeZone)
      if (parsed instanceof Error) {
        return new InvalidCronScheduleError({
          typeId: moduleId,
          job,
          schedule: cron.schedule,
          cause: parsed,
        })
      }
    }
    registry.set(moduleId, definition)
  }
  return registry
}

export function findModuleServer(registry: ModuleServerRegistry, moduleId: string) {
  return registry.get(moduleId) ?? new UnknownModuleError({ moduleId })
}
