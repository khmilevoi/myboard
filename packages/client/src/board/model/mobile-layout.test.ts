// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  deriveMobileLayout,
  HEIGHT_FLOOR_MIGRATION_ID,
  migrateBoardLayoutHeights,
  PASSPORT_CHECKER_HEIGHT_FLOOR_MIGRATION_ID,
  reconcileMobileLayout,
  resolveBoardLayout,
} from './mobile-layout'
import type { BoardSnapshot, LayoutItem } from './types'

const desktop: LayoutItem[] = [
  { i: 'right', x: 6, y: 0, w: 3, h: 4, minW: 2, minH: 2 },
  { i: 'left', x: 0, y: 0, w: 3, h: 2, minW: 2 },
  { i: 'bottom', x: 0, y: 4, w: 6, h: 3 },
]

// A typeId absent from the real widget catalog, so migrateBoardLayoutHeights
// cannot resolve a defaultSize for it and leaves these fixtures' arbitrary h
// values alone. These tests are about position/order mechanics, not sizing.
const UNCATALOGED_TYPE_ID = 'not-a-real-widget-type'

const makeBoard = (overrides: Partial<BoardSnapshot> = {}): BoardSnapshot => ({
  id: 'b1',
  name: 'Board',
  instances: [
    { id: 'right', typeId: UNCATALOGED_TYPE_ID },
    { id: 'left', typeId: UNCATALOGED_TYPE_ID },
    { id: 'bottom', typeId: UNCATALOGED_TYPE_ID },
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

// Real catalog widget used to exercise migrateBoardLayoutHeights against an
// actual current defaultSize.h, rather than an invented one.
const CATALOGED_TYPE_ID = 'ofelia-poop-duty'
const CATALOGED_DEFAULT_H = 8

describe('migrateBoardLayoutHeights', () => {
  it("bumps a persisted height that fell below its type's current default, and records the marker", () => {
    const board: BoardSnapshot = {
      id: 'b1',
      name: 'Board',
      instances: [{ id: 'duty', typeId: CATALOGED_TYPE_ID }],
      layout: [{ i: 'duty', x: 0, y: 0, w: 4, h: 6, minW: 2, minH: 3 }],
    }

    const { board: migrated, appliedMigrationIds } = migrateBoardLayoutHeights(board, [])

    expect(migrated.layout.find((item) => item.i === 'duty')).toMatchObject({
      h: CATALOGED_DEFAULT_H,
    })
    expect(appliedMigrationIds).toContain(HEIGHT_FLOOR_MIGRATION_ID)
  })

  it('also bumps a persisted mobileLayout height, not just the desktop layout', () => {
    const board: BoardSnapshot = {
      id: 'b1',
      name: 'Board',
      instances: [{ id: 'duty', typeId: CATALOGED_TYPE_ID }],
      layout: [{ i: 'duty', x: 0, y: 0, w: 4, h: CATALOGED_DEFAULT_H, minW: 2, minH: 3 }],
      mobileLayout: [{ i: 'duty', x: 0, y: 0, w: 1, h: 6, minW: 1, minH: 3 }],
    }

    const { board: migrated } = migrateBoardLayoutHeights(board, [])

    expect(migrated.mobileLayout?.find((item) => item.i === 'duty')).toMatchObject({
      h: CATALOGED_DEFAULT_H,
    })
  })

  it('raises passport checker layouts to their h4 floor even after the generic migration ran', () => {
    const board: BoardSnapshot = {
      id: 'b1',
      name: 'Board',
      instances: [{ id: 'passport', typeId: 'passport-checker' }],
      layout: [{ i: 'passport', x: 0, y: 0, w: 4, h: 2, minW: 2, minH: 2 }],
      mobileLayout: [{ i: 'passport', x: 0, y: 0, w: 1, h: 3, minW: 1, minH: 2 }],
    }

    const { board: migrated, appliedMigrationIds } = migrateBoardLayoutHeights(board, [
      HEIGHT_FLOOR_MIGRATION_ID,
    ])

    expect(migrated.layout).toEqual([{ i: 'passport', x: 0, y: 0, w: 4, h: 4, minW: 2, minH: 4 }])
    expect(migrated.mobileLayout).toEqual([
      { i: 'passport', x: 0, y: 0, w: 1, h: 4, minW: 1, minH: 4 },
    ])
    expect(appliedMigrationIds).toContain('passport-checker-height-floor-v1')
  })

  it('leaves an item already at or above its default untouched', () => {
    const board: BoardSnapshot = {
      id: 'b1',
      name: 'Board',
      instances: [{ id: 'duty', typeId: CATALOGED_TYPE_ID }],
      layout: [{ i: 'duty', x: 0, y: 0, w: 4, h: CATALOGED_DEFAULT_H, minW: 2, minH: 3 }],
    }

    expect(migrateBoardLayoutHeights(board, []).board.layout).toEqual(board.layout)
  })

  it('leaves an item whose typeId is not in the catalog untouched', () => {
    const board: BoardSnapshot = {
      id: 'b1',
      name: 'Board',
      instances: [{ id: 'x', typeId: 'not-a-real-widget-type' }],
      layout: [{ i: 'x', x: 0, y: 0, w: 1, h: 1 }],
    }

    expect(migrateBoardLayoutHeights(board, []).board.layout).toEqual(board.layout)
  })

  it('is a no-op once the marker is already recorded, even if a height sits below default', () => {
    const board: BoardSnapshot = {
      id: 'b1',
      name: 'Board',
      instances: [{ id: 'duty', typeId: CATALOGED_TYPE_ID }],
      layout: [{ i: 'duty', x: 0, y: 0, w: 4, h: 4, minW: 2, minH: 3 }],
    }
    const appliedIds = [HEIGHT_FLOOR_MIGRATION_ID, PASSPORT_CHECKER_HEIGHT_FLOOR_MIGRATION_ID]

    const result = migrateBoardLayoutHeights(board, appliedIds)

    expect(result.board).toBe(board)
    expect(result.appliedMigrationIds).toBe(appliedIds)
  })

  it('a deliberate user shrink below the default survives once the marker is recorded, across repeated reads', () => {
    const original: BoardSnapshot = {
      id: 'b1',
      name: 'Board',
      instances: [{ id: 'duty', typeId: CATALOGED_TYPE_ID }],
      layout: [{ i: 'duty', x: 0, y: 0, w: 4, h: 6, minW: 2, minH: 3 }],
    }

    // First load: the pre-existing h:6 is migrated up to the new default, h:8,
    // and the marker is recorded in the applied-ids list (persisted separately
    // from the board itself — see BoardMigrations in types.ts).
    const first = migrateBoardLayoutHeights(original, [])
    expect(first.board.layout.find((item) => item.i === 'duty')).toMatchObject({ h: 8 })
    expect(first.appliedMigrationIds).toContain(HEIGHT_FLOOR_MIGRATION_ID)

    // The user then resizes down to h:4, which is still >= minH: 3.
    const shrunk: BoardSnapshot = {
      ...first.board,
      layout: first.board.layout.map((item) => (item.i === 'duty' ? { ...item, h: 4 } : item)),
    }

    // A main-era tab, still on a pre-mobileLayout strict BoardSnapshotSchema,
    // touches this board and writes back exactly what its own parse
    // produced — silently dropping any field it doesn't recognise. The
    // applied-ids list never lived on the snapshot, so it is untouched by
    // this; only fields on the snapshot itself (like mobileLayout, if it were
    // present) would be at risk here.
    const strippedByMainEraClient: BoardSnapshot = JSON.parse(
      JSON.stringify({
        id: shrunk.id,
        name: shrunk.name,
        instances: shrunk.instances,
        layout: shrunk.layout,
      }),
    )

    // A reload (or another client syncing) re-runs the migration on read,
    // supplying the applied-ids list from its own separate storage key —
    // exactly as it was after the first migration, untouched by the
    // main-era write-back above.
    const afterReload = migrateBoardLayoutHeights(
      strippedByMainEraClient,
      first.appliedMigrationIds,
    )

    expect(afterReload.board).toBe(strippedByMainEraClient)
    expect(afterReload.board.layout.find((item) => item.i === 'duty')).toMatchObject({ h: 4 })
    expect(afterReload.appliedMigrationIds).toBe(first.appliedMigrationIds)
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

  it('does not clamp a stale persisted height itself — migration happens once at load, not on every read', () => {
    const board: BoardSnapshot = {
      id: 'b1',
      name: 'Board',
      instances: [{ id: 'duty', typeId: CATALOGED_TYPE_ID }],
      layout: [{ i: 'duty', x: 0, y: 0, w: 4, h: 4, minW: 2, minH: 3 }],
    }

    expect(resolveBoardLayout(board, false).find((item) => item.i === 'duty')).toMatchObject({
      h: 4,
    })
  })
})
