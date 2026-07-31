import { resolveTier } from 'widget-runtime'

import { passportCheckerWidget } from './client'

describe('passport checker client definition', () => {
  it('uses the tiny layout for the short-wide default placement footprint', () => {
    const tiers = passportCheckerWidget.tiers
    if (!tiers) throw new Error('expected a tiers config')

    expect(resolveTier({ width: 395, height: 150 }, tiers)).toBe('tiny')
  })

  it('enables the expanded layouts only at their 280px height floor', () => {
    const tiers = passportCheckerWidget.tiers
    if (!tiers) throw new Error('expected a tiers config')

    expect(resolveTier({ width: 395, height: 279 }, tiers)).toBe('tiny')
    expect(resolveTier({ width: 320, height: 280 }, tiers)).toBe('compact')
    expect(resolveTier({ width: 321, height: 280 }, tiers)).toBe('large')
  })

  it('declares the passport catalog metadata', () => {
    expect(passportCheckerWidget.title).toBe('Паспорт')
    expect(passportCheckerWidget.description).toBe('Проверка статуса паспорта')
    expect(passportCheckerWidget.icon).toBe('IdCard')
    expect(passportCheckerWidget.defaultSize).toEqual({ w: 4, h: 4, minW: 2, minH: 2 })
  })
})
