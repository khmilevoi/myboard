import type { RuntimeWidgetServerDefinition } from '@shared/widgets/contracts'

import { DuplicateWidgetTypeError, UnknownWidgetTypeError } from './errors'

export type WidgetServerRegistry = ReadonlyMap<string, RuntimeWidgetServerDefinition>

export function createWidgetServerRegistry(
  definitions: readonly RuntimeWidgetServerDefinition[],
): DuplicateWidgetTypeError | WidgetServerRegistry {
  const registry = new Map<string, RuntimeWidgetServerDefinition>()
  for (const definition of definitions) {
    if (registry.has(definition.typeId)) {
      return new DuplicateWidgetTypeError({ typeId: definition.typeId })
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
