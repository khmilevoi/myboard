export const MOBILE_BREAKPOINT = 768
export const BASE_WIDTH = 1920

export type GridMetrics = {
  isMobile: boolean
  cols: number
  rowHeight: number
  margin: [number, number]
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

/**
 * Maps a container width to the grid metrics React Grid Layout is configured with.
 *
 * Below MOBILE_BREAKPOINT the board collapses to a single column with a fixed row
 * height: at one column the column width jumps to ~370 px, and a scaled row would
 * make each step too coarse to size a card with a finger.
 *
 * Above it the whole grid is scaled by one factor. React Grid Layout derives the
 * column width from `width`, `margin` and `containerPadding` (which defaults to
 * `margin`), so scaling the margin scales the column width by the same factor —
 * the grid zooms instead of stretching on one axis, and aspect ratios are preserved.
 */
export const resolveGridMetrics = (width: number): GridMetrics => {
  if (width < MOBILE_BREAKPOINT) {
    return { isMobile: true, cols: 1, rowHeight: 40, margin: [10, 10] }
  }

  const scale = clamp(width / BASE_WIDTH, 0.75, 2.5)
  return { isMobile: false, cols: 12, rowHeight: 30 * scale, margin: [10 * scale, 10 * scale] }
}
