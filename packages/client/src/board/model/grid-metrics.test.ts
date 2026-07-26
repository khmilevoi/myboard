// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { BASE_WIDTH, MOBILE_BREAKPOINT, resolveGridMetrics } from './grid-metrics'

describe('resolveGridMetrics', () => {
  it('reproduces the previous hardcoded metrics at the base width', () => {
    // Regression barrier: existing 1080p boards must not shift by a pixel.
    expect(resolveGridMetrics(BASE_WIDTH)).toEqual({
      isMobile: false,
      cols: 12,
      rowHeight: 30,
      margin: [10, 10],
    })
  })

  it('scales the desktop grid by exactly two at double the base width', () => {
    expect(resolveGridMetrics(3840)).toEqual({
      isMobile: false,
      cols: 12,
      rowHeight: 60,
      margin: [20, 20],
    })
  })

  it('clamps the scale at 0.75 on narrow desktops', () => {
    expect(resolveGridMetrics(1280)).toEqual({
      isMobile: false,
      cols: 12,
      rowHeight: 22.5,
      margin: [7.5, 7.5],
    })
  })

  it('clamps the scale at 2.5 on ultrawide displays', () => {
    expect(resolveGridMetrics(10_000)).toEqual({
      isMobile: false,
      cols: 12,
      rowHeight: 75,
      margin: [25, 25],
    })
  })

  it('switches to a single column below the mobile breakpoint', () => {
    expect(resolveGridMetrics(MOBILE_BREAKPOINT - 1)).toEqual({
      isMobile: true,
      cols: 1,
      rowHeight: 40,
      margin: [10, 10],
    })
  })

  it('stays on the desktop grid at the breakpoint itself', () => {
    expect(resolveGridMetrics(MOBILE_BREAKPOINT).isMobile).toBe(false)
    expect(resolveGridMetrics(MOBILE_BREAKPOINT).cols).toBe(12)
  })

  it('keeps a fixed row height on mobile regardless of width', () => {
    expect(resolveGridMetrics(320).rowHeight).toBe(40)
    expect(resolveGridMetrics(500).rowHeight).toBe(40)
  })
})
