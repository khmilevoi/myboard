import { describe, expect, it } from 'vitest'
import { findWidgetType, widgetTypes, UnknownWidgetTypeError } from './registry'

describe('widget registry', () => {
  it('contains the clock widget', () => {
    expect(widgetTypes.some((t) => t.id === 'clock')).toBe(true)
  })

  it('finds a known type', () => {
    const type = findWidgetType('clock')
    if (type instanceof Error) throw type
    expect(type.id).toBe('clock')
    expect(type.entry).toBe('/widgets/clock/index.html')
    expect(type.defaultSize).toEqual({ w: 3, h: 2 })
  })

  it('returns UnknownWidgetTypeError for an unknown type', () => {
    const result = findWidgetType('missing')
    expect(result).toBeInstanceOf(UnknownWidgetTypeError)
  })
})
