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

  it('never renders a narrow desktop smaller than the base-width baseline', () => {
    // The zoom only goes upward, so the whole band between the mobile
    // breakpoint and BASE_WIDTH keeps the base metrics: no board shrinks and no
    // widget drops a tier on a laptop-width window.
    expect(resolveGridMetrics(1280)).toEqual({
      isMobile: false,
      cols: 12,
      rowHeight: 30,
      margin: [10, 10],
    })

    expect(resolveGridMetrics(800)).toEqual({
      isMobile: false,
      cols: 12,
      rowHeight: 30,
      margin: [10, 10],
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
