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

  it('loads the clock component', async () => {
    const type = findWidgetType('clock')
    if (type instanceof Error) throw type

    expect(type.id).toBe('clock')
    expect(type).not.toHaveProperty('entry')
    expect(typeof type.loadComponent).toBe('function')
    expect(type.defaultSize).toEqual({ w: 3, h: 4 })

    const mod = await type.loadComponent()
    expect(mod.default).toEqual(
      expect.objectContaining({ $$typeof: expect.any(Symbol), type: expect.any(Function) }),
    )
  })

  it('loads the Ofelia poop duty widget', async () => {
    const type = findWidgetType('ofelia-poop-duty')
    if (type instanceof Error) throw type

    expect(type).not.toHaveProperty('entry')
    expect(typeof type.loadComponent).toBe('function')
    expect(type).toMatchObject({
      id: 'ofelia-poop-duty',
      title: 'Лоток Офелии',
      description: 'Чья сегодня очередь убирать',
      defaultSize: { w: 3, h: 5 },
      icon: 'CalendarDays',
    })

    const mod = await type.loadComponent()
    expect(mod.default).toEqual(
      expect.objectContaining({ $$typeof: expect.any(Symbol), type: expect.any(Function) }),
    )
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
    expect(iconNames).toEqual(['Clock', 'CalendarDays'])
  })

  it('returns UnknownWidgetTypeError for an unknown type', () => {
    const result = findWidgetType('missing')
    expect(result).toBeInstanceOf(UnknownWidgetTypeError)
  })
})
