import { findWidgetType } from '@/widget-registry/model/registry'

import type { BoardSnapshot, LayoutItem, WidgetInstance } from './types'

/**
 * Id of the one-shot migration applied by migrateBoardLayoutHeights below.
 * Recorded per board id in board-storage.ts's localBoardMigrations /
 * sharedBoardMigrations (see BoardMigrations in types.ts) once applied; a
 * board carrying this id in its applied-ids list is never re-scanned, so a
 * later deliberate shrink below a type's current defaultSize.h is never
 * undone.
 */
export const HEIGHT_FLOOR_MIGRATION_ID = 'layout-height-floor-v1'

/**
 * Projects a desktop layout onto a single column.
 *
 * Sorting by y then x is desktop reading order, which is the order the board is
 * already perceived in. minW is clamped to 1 because a widget declaring minW: 2
 * would make the layout invalid at cols: 1 and React Grid Layout would silently
 * repair it. h and minH are inherited unchanged — vertical size is the only
 * dimension that transfers meaningfully between grids of different width.
 */
export const deriveMobileLayout = (layout: LayoutItem[]): LayoutItem[] => {
  let y = 0
  return [...layout]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((item) => {
      const next = { ...item, x: 0, y, w: 1, minW: 1 }
      y += item.h
      return next
    })
}

/**
 * Brings a stored mobile layout back in sync with the desktop one.
 *
 * mobileLayout can drift out of sync with the instances — a widget added from the
 * desktop while the phone was offline, or removed by another device. Relying on
 * every mutator to keep both arrays correct is fragile, so this runs on read.
 * Stale entries are dropped and missing ones are derived and appended below,
 * matching what makeLayout already does on the desktop.
 */
export const reconcileMobileLayout = (
  stored: LayoutItem[],
  desktop: LayoutItem[],
): LayoutItem[] => {
  const byId = new Map(desktop.map((item) => [item.i, item]))
  const kept = stored.filter((item) => byId.has(item.i))
  const knownIds = new Set(kept.map((item) => item.i))
  const missing = desktop.filter((item) => !knownIds.has(item.i))
  const offset = kept.reduce((max, item) => Math.max(max, item.y + item.h), 0)

  return [...kept, ...deriveMobileLayout(missing).map((item) => ({ ...item, y: item.y + offset }))]
}

const bumpHeightsToDefault = (
  items: LayoutItem[],
  typeIdById: Map<string, string>,
): { items: LayoutItem[]; changed: boolean } => {
  let changed = false
  const next = items.map((item) => {
    const typeId = typeIdById.get(item.i)
    if (!typeId) return item

    const type = findWidgetType(typeId)
    if (type instanceof Error) return item
    if (item.h >= type.defaultSize.h) return item

    changed = true
    return { ...item, h: type.defaultSize.h }
  })

  return { items: next, changed }
}

/**
 * One-shot migration: bumps a placed widget's persisted height up to its
 * type's current defaultSize.h when it falls short, then records
 * HEIGHT_FLOOR_MIGRATION_ID in the returned applied-ids list so it never
 * runs again for this board.
 *
 * defaultSize is only applied when a widget is first added (see makeLayout
 * in board-model.ts) — nothing else migrates the h already persisted for a
 * widget placed under an older, shorter default. When a widget package
 * raises its size floor (e.g. a tier's minHeightPx), an already-placed
 * instance can silently sit below the new floor and render a degraded tier
 * forever.
 *
 * This must run exactly once per board, at load (see board-storage.ts), not
 * on every read: a per-read clamp would also undo a later deliberate resize
 * below the new default, since react-grid-layout legitimately allows sizes
 * down to a type's minH, which sits well below defaultSize.h for most
 * widgets. The caller supplies the ids already applied to this board
 * (persisted separately from the snapshot — see BoardMigrations in
 * types.ts, and why in board-storage.ts) rather than reading them off the
 * board itself. Both the board and the ids list come back by the same
 * reference when the marker is already present, so callers can rely on
 * referential stability to skip an unnecessary write-back on either atom.
 */
export const migrateBoardLayoutHeights = (
  board: BoardSnapshot,
  appliedMigrationIds: readonly string[],
): { board: BoardSnapshot; appliedMigrationIds: string[] } => {
  if (appliedMigrationIds.includes(HEIGHT_FLOOR_MIGRATION_ID)) {
    return { board, appliedMigrationIds: appliedMigrationIds as string[] }
  }

  const typeIdById = new Map(
    board.instances.map((instance: WidgetInstance) => [instance.id, instance.typeId]),
  )
  const layoutResult = bumpHeightsToDefault(board.layout, typeIdById)
  const mobileResult = board.mobileLayout
    ? bumpHeightsToDefault(board.mobileLayout, typeIdById)
    : null

  return {
    board: {
      ...board,
      layout: layoutResult.items,
      ...(mobileResult ? { mobileLayout: mobileResult.items } : {}),
    },
    appliedMigrationIds: [...appliedMigrationIds, HEIGHT_FLOOR_MIGRATION_ID],
  }
}

export const resolveBoardLayout = (board: BoardSnapshot, isMobile: boolean): LayoutItem[] => {
  if (!isMobile) return board.layout
  if (!board.mobileLayout) return deriveMobileLayout(board.layout)
  return reconcileMobileLayout(board.mobileLayout, board.layout)
}
