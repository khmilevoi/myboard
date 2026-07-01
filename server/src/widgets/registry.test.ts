import type { RuntimeWidgetServerDefinition } from '@shared/widgets/contracts'
import { describe, expect, it } from 'vitest'

import { DuplicateWidgetTypeError, UnknownWidgetTypeError } from './errors'
import { createWidgetServerRegistry, findWidgetServer } from './registry'

const definition: RuntimeWidgetServerDefinition = {
  typeId: 'test-widget',
  schemas: {},
  handlers: {},
}

describe('widget server registry', () => {
  it('finds a registered definition', () => {
    const registry = createWidgetServerRegistry([definition])
    if (registry instanceof Error) throw registry
    expect(findWidgetServer(registry, 'test-widget')).toBe(definition)
  })

  it('returns an error for an unknown widget', () => {
    const registry = createWidgetServerRegistry([definition])
    if (registry instanceof Error) throw registry
    expect(findWidgetServer(registry, 'missing')).toBeInstanceOf(UnknownWidgetTypeError)
  })

  it('rejects duplicate type IDs', () => {
    expect(createWidgetServerRegistry([definition, definition])).toBeInstanceOf(
      DuplicateWidgetTypeError,
    )
  })
})
