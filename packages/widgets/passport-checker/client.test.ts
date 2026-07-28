import { resolveTier } from 'widget-runtime'

import { passportCheckerWidget } from './client'

describe('passport checker client definition', () => {
  it('collapses to two layouts at the 321px breakpoint', () => {
    const tiers = passportCheckerWidget.tiers
    if (!tiers) throw new Error('expected a tiers config')
    expect(resolveTier({ width: 320, height: 400 }, tiers)).toBe('compact')
    expect(resolveTier({ width: 321, height: 400 }, tiers)).toBe('large')
  })

  it('declares the passport catalog metadata', () => {
    expect(passportCheckerWidget.title).toBe('Паспорт')
    expect(passportCheckerWidget.description).toBe('Проверка статуса паспорта')
    expect(passportCheckerWidget.icon).toBe('IdCard')
    expect(passportCheckerWidget.defaultSize).toEqual({ w: 4, h: 4, minW: 2, minH: 2 })
  })
})
