import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import {
  formatKgValue,
  formatMeasurementCount,
  formatTick,
  formatTrendLabel,
} from '../model/format'
import type { WeightPeriod, WeightPoint } from '../model/weight-view'
import { timeScale } from './Sparkline'

import styles from './weight.module.css'

// The design's geometry: a 648×260 canvas, plot area from x 44 to 640 and between the top and
// bottom gridlines, date labels under it.
const VIEW_W = 648
const VIEW_H = 260
const PLOT_LEFT = 44
const PLOT_RIGHT = 640
const GRID_TOP = 20
const GRID_BOTTOM = 200
const LABEL_Y = 236
const X_TICKS = 5

export type TrendChartProps = {
  points: WeightPoint[]
  period: WeightPeriod
  now: number
}

/** The large trend: gridlines, weight and date axes, and a dot per reading (the newest filled). */
export const TrendChart = reatomMemo<TrendChartProps>(({ points, period, now }) => {
  if (points.length < 2) return null

  const kgs = points.map((p) => p.kg)
  const min = Math.min(...kgs)
  const max = Math.max(...kgs)
  // Padded so the extreme dots sit inside the gridlines rather than on them.
  const pad = Math.max((max - min) * 0.08, 0.1)
  const top = max + pad
  const bottom = min - pad
  const toX = timeScale(points)
  const x = (point: WeightPoint, index: number) =>
    PLOT_LEFT + toX(point, index) * (PLOT_RIGHT - PLOT_LEFT)
  const y = (kg: number) => GRID_TOP + ((top - kg) / (top - bottom)) * (GRID_BOTTOM - GRID_TOP)

  const gridlines = [
    { y: GRID_TOP, kg: top },
    { y: (GRID_TOP + GRID_BOTTOM) / 2, kg: (top + bottom) / 2 },
    { y: GRID_BOTTOM, kg: bottom },
  ]
  const first = points[0].takenAt
  const last = points[points.length - 1].takenAt
  const ticks = Array.from({ length: X_TICKS }, (_, index) => {
    const share = index / (X_TICKS - 1)
    return {
      x: PLOT_LEFT + share * (PLOT_RIGHT - PLOT_LEFT),
      label: formatTick(first + share * (last - first), now),
      anchor: (index === 0 ? 'start' : index === X_TICKS - 1 ? 'end' : 'middle') as
        | 'start'
        | 'middle'
        | 'end',
    }
  })
  const coords = points.map((point, index) => ({ cx: x(point, index), cy: y(point.kg) }))
  const newest = coords[coords.length - 1]

  return (
    <svg
      className={styles.chart}
      role="img"
      aria-label={`${formatTrendLabel(points, period)}, ${formatMeasurementCount(points.length)}`}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
    >
      <g className={styles.axis}>
        {gridlines.map((line) => (
          <g key={line.y}>
            <line
              className={styles.gridline}
              x1={PLOT_LEFT}
              x2={PLOT_RIGHT}
              y1={line.y}
              y2={line.y}
            />
            <text x={0} y={line.y + 4}>
              {formatKgValue(line.kg)}
            </text>
          </g>
        ))}
        {ticks.map((tick) => (
          <text key={tick.x} x={tick.x} y={LABEL_Y} textAnchor={tick.anchor}>
            {tick.label}
          </text>
        ))}
      </g>
      <polyline
        className={styles.chartLine}
        points={coords.map(({ cx, cy }) => `${cx.toFixed(1)},${cy.toFixed(1)}`).join(' ')}
      />
      <g className={styles.dot}>
        {coords.slice(0, -1).map(({ cx, cy }, index) => (
          <circle key={index} cx={cx} cy={cy} r={3.5} />
        ))}
      </g>
      <circle className={styles.dotNewest} cx={newest.cx} cy={newest.cy} r={5} />
    </svg>
  )
}, 'TrendChart')
