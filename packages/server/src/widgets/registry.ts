import type { RuntimeWidgetServerDefinition } from '@shared/widgets/contracts'
import { Cron } from 'croner'

import {
  DuplicateWidgetTypeError,
  InvalidCronScheduleError,
  UnknownWidgetTypeError,
} from './errors'

export type WidgetServerRegistry = ReadonlyMap<string, RuntimeWidgetServerDefinition>

export function createWidgetServerRegistry(
  definitions: readonly RuntimeWidgetServerDefinition[],
): DuplicateWidgetTypeError | InvalidCronScheduleError | WidgetServerRegistry {
  const registry = new Map<string, RuntimeWidgetServerDefinition>()
  for (const definition of definitions) {
    if (registry.has(definition.typeId)) {
      return new DuplicateWidgetTypeError({ typeId: definition.typeId })
    }
    for (const [job, cron] of Object.entries(definition.crons)) {
      const parsed = tryParseCron(cron.schedule, cron.timeZone)
      if (parsed instanceof Error) {
        return new InvalidCronScheduleError({
          typeId: definition.typeId,
          job,
          schedule: cron.schedule,
          cause: parsed,
        })
      }
    }
    registry.set(definition.typeId, definition)
  }
  return registry
}

export function findWidgetServer(
  registry: WidgetServerRegistry,
  typeId: string,
): UnknownWidgetTypeError | RuntimeWidgetServerDefinition {
  return registry.get(typeId) ?? new UnknownWidgetTypeError({ typeId })
}

/**
 * Constructed and discarded: a schedule that cannot be parsed must fail at
 * startup rather than silently never fire. The scheduler builds its own Cron
 * objects. croner throws on a malformed pattern or an unknown zone, and this is
 * the one place that throw is converted into a value.
 */
function tryParseCron(schedule: string, timeZone: string): Error | Cron {
  try {
    const cron = new Cron(schedule, { timezone: timeZone })
    if (cron.nextRun() === null) return new Error(`schedule "${schedule}" never runs`)
    return cron
  } catch (cause) {
    return cause instanceof Error ? cause : new Error(String(cause))
  }
}
