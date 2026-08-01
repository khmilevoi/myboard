import { resolveTier } from 'widget-runtime'

import { passportCheckerWidget } from './client'

describe('passport checker client definition', () => {
  const desktopCardHeight = (rows: number) => rows * 30 + (rows - 1) * 10
  const desktopCardWidth = (columns: number) => {
    const containerWidth = 768
    const gridColumns = 12
    const gap = 10
    const containerPadding = 10
    const columnWidth =
      (containerWidth - containerPadding * 2 - gap * (gridColumns - 1)) / gridColumns
    return columnWidth * columns + gap * (columns - 1)
  }

  it('uses the tiny layout for the short-wide default placement footprint', () => {
    const tiers = passportCheckerWidget.tiers
    if (!tiers) throw new Error('expected a tiers config')

    expect(resolveTier({ width: 395, height: 150 }, tiers)).toBe('tiny')
  })

  it('keeps the compact layout through the default-height placement', () => {
    const tiers = passportCheckerWidget.tiers
    if (!tiers) throw new Error('expected a tiers config')

    expect(resolveTier({ width: 395, height: 279 }, tiers)).toBe('tiny')
    expect(resolveTier({ width: 320, height: 399 }, tiers)).toBe('compact')
    expect(resolveTier({ width: 321, height: 399 }, tiers)).toBe('compact')
    expect(resolveTier({ width: 321, height: 400 }, tiers)).toBe('large')
  })

  it('declares the passport catalog metadata', () => {
    expect(passportCheckerWidget.title).toBe('Паспорт')
    expect(passportCheckerWidget.description).toBe('Проверка статуса паспорта')
    expect(passportCheckerWidget.icon).toBe('IdCard')
    expect(passportCheckerWidget.defaultSize).toEqual({ w: 3, h: 3, minW: 3, minH: 3 })
  })

  it('does not advertise h2 cards that clip TinyTier status, controls, and its action', () => {
    // Tiny's summary needs an 88px floor: 70px (h2) clips the top controls or
    // the refresh action, while h3 leaves 110px at the desktop board geometry.
    expect(desktopCardHeight(2)).toBe(70)
    expect(desktopCardHeight(3)).toBe(110)
    expect(desktopCardHeight(passportCheckerWidget.defaultSize.h)).toBe(110)
    expect(passportCheckerWidget.defaultSize.minH).toBe(3)
  })

  it('does not advertise a w2 TinyTier card that clips status controls and the refresh action', () => {
    // At the 768px desktop boundary RGL has 12 columns, a 10px margin, and
    // 10px container padding. Tiny's two management controls, status text,
    // and the refresh action need a 136px floor; w2 is narrower while w3 is
    // safely above it.
    const requiredTinyWidth = 136
    const tiers = passportCheckerWidget.tiers
    if (!tiers) throw new Error('expected a tiers config')

    expect(desktopCardWidth(2)).toBeCloseTo(116.33, 2)
    expect(desktopCardWidth(2)).toBeLessThan(requiredTinyWidth)
    expect(desktopCardWidth(3)).toBeGreaterThan(requiredTinyWidth)
    expect(resolveTier({ width: desktopCardWidth(3), height: 110 }, tiers)).toBe('tiny')
    expect(passportCheckerWidget.defaultSize.minW).toBe(3)
  })
})
