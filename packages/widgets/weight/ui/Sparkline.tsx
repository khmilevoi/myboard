import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import { formatTrendLabel } from '../model/format'
import type { WeightPeriod, WeightPoint } from '../model/weight-view'

import styles from './weight.module.css'

const WIDTH = 300
const INSET = 4

/**
 * Maps a time to `[0, 1]` across the points' own span, so the line fills the width. Points that
 * share one instant fall back to even spacing.
 */
export function timeScale(points: WeightPoint[]): (point: WeightPoint, index: number) => number {
  const first = points[0]?.takenAt ?? 0
  const span = (points[points.length - 1]?.takenAt ?? 0) - first
  if (span <= 0) return (_point, index) => (points.length > 1 ? index / (points.length - 1) : 0)
  return (point) => (point.takenAt - first) / span
}

export type SparklineProps = {
  points: WeightPoint[]
  period: WeightPeriod
  /** viewBox height; the CSS class sets the rendered height to match. */
  height: number
  className?: string
}

/** A bare trend line. Drawn only with two or more points: one point is not a trend. */
export const Sparkline = reatomMemo<SparklineProps>(({ points, period, height, className }) => {
  if (points.length < 2) return null

  const kgs = points.map((p) => p.kg)
  const min = Math.min(...kgs)
  const max = Math.max(...kgs)
  const x = timeScale(points)
  const y = (kg: number) =>
    max === min ? height / 2 : INSET + ((max - kg) / (max - min)) * (height - INSET * 2)
  const polyline = points
    .map((point, index) => `${(x(point, index) * WIDTH).toFixed(1)},${y(point.kg).toFixed(1)}`)
    .join(' ')

  return (
    <svg
      className={`${styles.spark} ${className ?? ''}`}
      role="img"
      aria-label={formatTrendLabel(points, period)}
      viewBox={`0 0 ${WIDTH} ${height}`}
      preserveAspectRatio="none"
    >
      <polyline className={styles.line} points={polyline} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}, 'Sparkline')
