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
 *
 * The zoom only goes upward. The lower clamp is 1, so the *metrics* never fall
 * below their BASE_WIDTH baseline: at every desktop width up to BASE_WIDTH,
 * `rowHeight` stays 30 and `margin` stays `[10, 10]`, and only displays wider
 * than BASE_WIDTH scale up.
 *
 * That pins the metrics, not the rendered geometry. Column width is still
 * derived from the measured container, and the board now measures its real
 * container — the viewport minus its own 20px padding on each side and the
 * stable scrollbar gutter — instead of the hardcoded 1280 the previous code
 * reported on every screen. So card widths do change per screen: a `w: 4` card
 * is 395 px at a 1280 viewport where the old code drew 413 px, which can put a
 * widget below its own tier thresholds even though no metric shrank.
 */
export const resolveGridMetrics = (width: number): GridMetrics => {
  if (width < MOBILE_BREAKPOINT) {
    return { isMobile: true, cols: 1, rowHeight: 40, margin: [10, 10] }
  }

  const scale = clamp(width / BASE_WIDTH, 1, 2.5)
  return { isMobile: false, cols: 12, rowHeight: 30 * scale, margin: [10 * scale, 10 * scale] }
}
