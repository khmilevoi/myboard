import { describe, expect, it } from 'vitest'
import { findWidgetType, widgetTypes, UnknownWidgetTypeError, type WidgetIconName } from './registry'

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

  it('finds the Ofelia poop duty widget', () => {
    const type = findWidgetType('ofelia-poop-duty')
    if (type instanceof Error) throw type
    expect(type).toMatchObject({
      id: 'ofelia-poop-duty',
      title: 'Какахи Офелии',
      entry: '/widgets/ofelia-poop-duty/index.html',
      defaultSize: { w: 3, h: 2 },
      icon: 'CalendarDays',
    })
  })

  it('uses a shared widget icon name type', () => {
    const iconNames: WidgetIconName[] = widgetTypes.map((type) => type.icon)
    expect(iconNames).toEqual(['Clock', 'CalendarDays'])
  })

  it('returns UnknownWidgetTypeError for an unknown type', () => {
    const result = findWidgetType('missing')
    expect(result).toBeInstanceOf(UnknownWidgetTypeError)
  })
})
