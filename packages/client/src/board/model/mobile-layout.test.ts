// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { deriveMobileLayout, reconcileMobileLayout, resolveBoardLayout } from './mobile-layout'
import type { BoardSnapshot, LayoutItem } from './types'

const desktop: LayoutItem[] = [
  { i: 'right', x: 6, y: 0, w: 3, h: 4, minW: 2, minH: 2 },
  { i: 'left', x: 0, y: 0, w: 3, h: 2, minW: 2 },
  { i: 'bottom', x: 0, y: 4, w: 6, h: 3 },
]

const makeBoard = (overrides: Partial<BoardSnapshot> = {}): BoardSnapshot => ({
  id: 'b1',
  name: 'Board',
  instances: [
    { id: 'right', typeId: 'clock' },
    { id: 'left', typeId: 'clock' },
    { id: 'bottom', typeId: 'clock' },
  ],
  layout: desktop,
  ...overrides,
})

describe('deriveMobileLayout', () => {
  it('stacks items in desktop reading order', () => {
    expect(deriveMobileLayout(desktop).map((item) => item.i)).toEqual(['left', 'right', 'bottom'])
  })

  it('clamps width and minimum width to a single column', () => {
    for (const item of deriveMobileLayout(desktop)) {
      expect(item.x).toBe(0)
      expect(item.w).toBe(1)
      expect(item.minW).toBe(1)
    }
  })

  it('inherits height and minimum height unchanged', () => {
    const derived = deriveMobileLayout(desktop)
    expect(derived.find((item) => item.i === 'right')).toMatchObject({ h: 4, minH: 2 })
    expect(derived.find((item) => item.i === 'bottom')).toMatchObject({ h: 3 })
    expect(derived.find((item) => item.i === 'bottom')?.minH).toBeUndefined()
  })

  it('accumulates y so nothing overlaps', () => {
    expect(deriveMobileLayout(desktop).map((item) => item.y)).toEqual([0, 2, 6])
  })

  it('does not mutate the input', () => {
    const input = [...desktop]
    deriveMobileLayout(input)
    expect(input).toEqual(desktop)
  })
})

describe('reconcileMobileLayout', () => {
  const stored: LayoutItem[] = [
    { i: 'left', x: 0, y: 0, w: 1, h: 5, minW: 1 },
    { i: 'gone', x: 0, y: 5, w: 1, h: 2, minW: 1 },
  ]

  it('drops entries whose instance no longer exists on the desktop', () => {
    expect(reconcileMobileLayout(stored, desktop).map((item) => item.i)).not.toContain('gone')
  })

  it('leaves stored positions untouched', () => {
    expect(reconcileMobileLayout(stored, desktop)[0]).toEqual({
      i: 'left',
      x: 0,
      y: 0,
      w: 1,
      h: 5,
      minW: 1,
    })
  })

  it('appends missing items below the stored ones in reading order', () => {
    const result = reconcileMobileLayout(stored, desktop)
    expect(result.map((item) => item.i)).toEqual(['left', 'right', 'bottom'])
    // offset = max(y + h) over kept items = 0 + 5
    expect(result.find((item) => item.i === 'right')).toMatchObject({ x: 0, y: 5, w: 1, h: 4 })
    expect(result.find((item) => item.i === 'bottom')).toMatchObject({ x: 0, y: 9, w: 1, h: 3 })
  })

  it('derives everything when nothing was stored', () => {
    expect(reconcileMobileLayout([], desktop)).toEqual(deriveMobileLayout(desktop))
  })
})

describe('resolveBoardLayout', () => {
  it('returns the desktop layout untouched on desktop', () => {
    const board = makeBoard({ mobileLayout: [{ i: 'left', x: 0, y: 0, w: 1, h: 9, minW: 1 }] })
    expect(resolveBoardLayout(board, false)).toBe(board.layout)
  })

  it('derives from the desktop layout when no override was stored', () => {
    expect(resolveBoardLayout(makeBoard(), true)).toEqual(deriveMobileLayout(desktop))
  })

  it('reconciles the stored override against the desktop layout', () => {
    const mobileLayout: LayoutItem[] = [{ i: 'left', x: 0, y: 0, w: 1, h: 9, minW: 1 }]
    expect(resolveBoardLayout(makeBoard({ mobileLayout }), true)).toEqual(
      reconcileMobileLayout(mobileLayout, desktop),
    )
  })
})
