import { resolveTier } from 'widget-runtime'

import { passportCheckerWidget } from './client'

describe('passport checker client definition', () => {
  const desktopCardHeight = (rows: number) => rows * 30 + (rows - 1) * 10

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
    expect(passportCheckerWidget.defaultSize).toEqual({ w: 4, h: 4, minW: 2, minH: 4 })
  })

  it('does not advertise h2 or h3 cards that clip TinyTier results and its action', () => {
    // Desktop board geometry uses a 30px row with a 10px vertical gap. The
    // h2/h3 footprints are 70px/110px; TinyTier needs the default h4's 150px
    // to keep its title, two visible document outcomes, and action accessible.
    expect(desktopCardHeight(2)).toBe(70)
    expect(desktopCardHeight(3)).toBe(110)
    expect(desktopCardHeight(passportCheckerWidget.defaultSize.h)).toBe(150)
    expect(passportCheckerWidget.defaultSize.minH).toBe(4)
  })
})
