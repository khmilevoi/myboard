import type { BoardSnapshot, LayoutItem } from './types'

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

export const resolveBoardLayout = (board: BoardSnapshot, isMobile: boolean): LayoutItem[] => {
  if (!isMobile) return board.layout
  if (!board.mobileLayout) return deriveMobileLayout(board.layout)
  return reconcileMobileLayout(board.mobileLayout, board.layout)
}
