import { describe, expect, it } from 'vitest'

import {
  findWidgetType,
  widgetTypes,
  UnknownWidgetTypeError,
  type WidgetIconName,
} from './registry'

describe('widget registry', () => {
  it('contains the clock widget', () => {
    expect(widgetTypes.some((t) => t.id === 'clock')).toBe(true)
  })

  it('gives every widget a Russian title and description', () => {
    const clock = findWidgetType('clock')
    if (clock instanceof Error) throw clock
    expect(clock.title).toBe('Часы')
    expect(clock.description).toBe('Текущее время и дата')
    for (const type of widgetTypes) {
      expect(type.description.length).toBeGreaterThan(0)
    }
  })

  it('uses a shared widget icon name type', () => {
    const iconNames: WidgetIconName[] = widgetTypes.map((type) => type.icon)
    expect(iconNames).toEqual(['Clock', 'Cat'])
  })

  it('returns UnknownWidgetTypeError for an unknown type', () => {
    const result = findWidgetType('missing')
    expect(result).toBeInstanceOf(UnknownWidgetTypeError)
  })
})
