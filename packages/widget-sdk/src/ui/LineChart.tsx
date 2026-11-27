import { cn } from '../lib/utils'
import { reatomMemo } from '../reatom/reatom-memo'

import styles from './LineChart.module.css'

export type LineChartPoint = {
  /** An ISO date or date-time; points are placed along x by time. */
  x: string
  y: number
}

export type LineChartProps = {
  /** In x order. */
  points: LineChartPoint[]
  /**
   * Drawn top to bottom on evenly spaced gridlines, the first on the largest `y` and the last on
   * the smallest: the data always spans exactly from the top gridline to the bottom one.
   * `full` only.
   */
  yLabels: string[]
  /** Each at the x position of its `at` (an ISO date or date-time, like `points[].x`). */
  xLabels: { at: string; label: string }[]
  /**
   * The values the top and bottom gridlines stand for. Absent, the data's own largest and
   * smallest `y` do. Give it when `yLabels` name a wider range than the data.
   */
  yDomain?: { min: number; max: number }
  /** `spark`: a bare line with ticks under it, for cards. `full`: gridlines and both axes. */
  variant: 'spark' | 'full'
  /** What the chart shows, for assistive tech: the drawing itself is hidden. */
  summary: string
  /** Sizes the chart; `spark` is 44 px tall and `full` at least 220 px by default. */
  className?: string
}

const VIEW = {
  spark: { width: 300, height: 44, top: 5, bottom: 38 },
  full: { width: 600, height: 220, top: 20, bottom: 200 },
} as const

/** The time span of the points along x, or null when any x is not a date (then by index). */
function timeSpan(xs: readonly string[]): { first: number; span: number } | null {
  const times = xs.map((x) => Date.parse(x))
  if (times.length === 0 || times.some(Number.isNaN)) return null
  const first = Math.min(...times)
  return { first, span: Math.max(...times) - first }
}

/** 0..1 along x for `x`; a lone point, or a span of one instant, sits at the right end. */
function xFraction(
  x: string,
  index: number,
  count: number,
  time: { first: number; span: number } | null,
): number {
  if (time === null) return count < 2 ? 1 : index / (count - 1)
  const at = Date.parse(x)
  if (Number.isNaN(at) || time.span === 0) return 1
  return Math.min(1, Math.max(0, (at - time.first) / time.span))
}

const round = (value: number) => Math.round(value * 100) / 100
const percent = (fraction: number) => `${round(fraction * 100)}%`

/**
 * A hand-drawn line chart: one SVG polyline, with the labels and the end dot as HTML over it, so
 * they keep their size while the SVG stretches to its box. No chart dependency.
 */
export const LineChart = reatomMemo<LineChartProps>(
  ({ points, yLabels, xLabels, variant, summary, className, yDomain }) => {
    const view = VIEW[variant]
    const ys = points.map((point) => point.y)
    const max = yDomain?.max ?? Math.max(...ys)
    const min = yDomain?.min ?? Math.min(...ys)
    const yOf = (value: number) =>
      max === min
        ? (view.top + view.bottom) / 2
        : view.top + ((max - value) / (max - min)) * (view.bottom - view.top)

    const time = timeSpan(points.map((point) => point.x))
    const coords = points.map((point, index) => ({
      x: round(xFraction(point.x, index, points.length, time) * view.width),
      y: round(yOf(point.y)),
    }))
    const last = coords.at(-1)

    const gridYs =
      variant === 'full' && yLabels.length > 1
        ? yLabels.map(
            (_, index) => view.top + (index / (yLabels.length - 1)) * (view.bottom - view.top),
          )
        : []

    return (
      <div className={cn(styles.root, className)} data-variant={variant}>
        <span className={styles.summary}>{summary}</span>
        <div className={styles.chart} aria-hidden="true">
          {gridYs.length > 0 && (
            <div className={styles.yAxis}>
              {yLabels.map((label, index) => (
                <span
                  key={`${index}-${label}`}
                  className={styles.yLabel}
                  style={{ top: percent(gridYs[index] / view.height) }}
                >
                  {label}
                </span>
              ))}
            </div>
          )}
          <div className={styles.plot}>
            <svg
              className={styles.svg}
              viewBox={`0 0 ${view.width} ${view.height}`}
              preserveAspectRatio="none"
            >
              {gridYs.map((y) => (
                <line key={y} className={styles.grid} x1={0} y1={y} x2={view.width} y2={y} />
              ))}
              {coords.length > 1 && (
                <polyline
                  className={styles.line}
                  points={coords.map(({ x, y }) => `${x},${y}`).join(' ')}
                />
              )}
            </svg>
            {last && (
              <span
                className={styles.dot}
                style={{ left: percent(last.x / view.width), top: percent(last.y / view.height) }}
              />
            )}
          </div>
          {xLabels.length > 0 && (
            <div className={styles.xAxis}>
              {xLabels.map(({ at, label }, index) => {
                const position = percent(xFraction(at, index, xLabels.length, time))
                // Shifting a label by its own position keeps the first flush left and the last
                // flush right, and centres the ones between on their date.
                return (
                  <span
                    key={`${at}-${label}`}
                    className={styles.xLabel}
                    style={{ left: position, translate: `-${position} 0` }}
                  >
                    {label}
                  </span>
                )
              })}
            </div>
          )}
        </div>
      </div>
    )
  },
  'LineChart',
)
