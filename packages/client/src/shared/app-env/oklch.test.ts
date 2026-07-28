import { describe, expect, it } from 'vitest'

import { oklchToHex } from './oklch'

describe('oklchToHex', () => {
  it('reproduces the fill of the committed production icons', () => {
    // Every public/*.svg carries fill="#645fd1" and every public/*.png has
    // that exact colour at its centre. tokens.css declares the same accent as
    // oklch(0.55 0.17 281). If this assertion ever moves, the conversion is
    // wrong, not the icons.
    expect(oklchToHex(0.55, 0.17, 281)).toBe('#645fd1')
  })

  it('round-trips the sRGB primaries and extremes', () => {
    expect(oklchToHex(1, 0, 0)).toBe('#ffffff')
    expect(oklchToHex(0, 0, 0)).toBe('#000000')
    expect(oklchToHex(0.62796, 0.25768, 29.234)).toBe('#ff0000')
    expect(oklchToHex(0.86644, 0.29483, 142.495)).toBe('#00ff00')
    expect(oklchToHex(0.45201, 0.31321, 264.052)).toBe('#0000ff')
  })

  it('clamps out-of-gamut colours instead of emitting NaN', () => {
    // `(-0.1) ** (1/2.4)` is NaN, which would stringify to "NaN" and produce
    // an icon fill the browser silently drops. Clamping happens in linear
    // space, before the gamma transfer.
    expect(oklchToHex(0.55, 0.4, 281)).toBe('#7000ff')
    expect(oklchToHex(0.9, 0.4, 145)).toBe('#00ff00')
  })

  it('emits the registry accents', () => {
    expect(oklchToHex(0.55, 0.17, 85)).toBe('#9e6500')
    expect(oklchToHex(0.55, 0.17, 345)).toBe('#b23e88')
    expect(oklchToHex(0.55, 0.17, 190)).toBe('#008e87')
  })
})
