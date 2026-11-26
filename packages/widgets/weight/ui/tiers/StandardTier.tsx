import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import {
  formatDelta,
  formatKgValue,
  formatTakenAt,
  formatTick,
  PERIOD_LABELS,
  PERIOD_SUFFIXES,
} from '@/model/format'
import { WEIGHT_PERIODS, type WeightCardData, type WeightPeriod } from '@/model/weight-view'

import { Sparkline } from '../Sparkline'

import styles from '../weight.module.css'

export type WeightValueProps = { kg: number; size: 'md' | 'lg' | 'xl' }

/** `83,0 кг` with the unit set apart; the text content reads `83,0 кг`. */
export const WeightValue = reatomMemo<WeightValueProps>(({ kg, size }) => {
  return (
    <span className={styles.value} data-size={size} data-testid="weight-value">
      <span className={styles.number}>{formatKgValue(kg)}</span>{' '}
      <span className={styles.unit}>кг</span>
    </span>
  )
}, 'WeightValue')

export type DeltaTextProps = { data: WeightCardData; className?: string }

/** `−1,4 кг за 30 дней`; nothing without two readings. Always neutral: there is no weight goal. */
export const DeltaText = reatomMemo<DeltaTextProps>(({ data, className }) => {
  if (data.delta === null) return null
  return (
    <span className={`${styles.delta} ${className ?? ''}`} data-testid="weight-delta">
      {formatDelta(data.delta)} {PERIOD_SUFFIXES[data.period]}
    </span>
  )
}, 'DeltaText')

export type PeriodControlProps = {
  selected: WeightPeriod
  onSelect: (period: WeightPeriod) => void
  className?: string
}

export const PeriodControl = reatomMemo<PeriodControlProps>(({ selected, onSelect, className }) => {
  return (
    <div className={`${styles.segmented} ${className ?? ''}`} role="group" aria-label="Период">
      {WEIGHT_PERIODS.map((period) => (
        <button
          key={period}
          type="button"
          aria-pressed={period === selected}
          onClick={() => onSelect(period)}
        >
          {PERIOD_LABELS[period]}
        </button>
      ))}
    </div>
  )
}, 'PeriodControl')

export type TrendHoleProps = { data: WeightCardData; hint?: boolean }

/** Stands in for the trend when there is nothing to draw: no reading in the period, or one. */
export const TrendHole = reatomMemo<TrendHoleProps>(({ data, hint = true }) => {
  if (data.state === 'no-period-data') {
    return (
      <div className={styles.hole}>
        <b>Нет измерений за период</b>
        {hint && <span className={styles.small}>Выберите период длиннее</span>}
      </div>
    )
  }
  return (
    <div className={styles.hole}>
      <b>Первое измерение</b>
      <span className={styles.small}>Тренд появится со второго</span>
    </div>
  )
}, 'TrendHole')

/** The first, middle and last moment of the drawn points, as axis labels. */
export function sparklineTicks(data: WeightCardData): string[] {
  const first = data.points[0]?.takenAt
  const last = data.points[data.points.length - 1]?.takenAt
  if (first === undefined || last === undefined) return []
  return [first, (first + last) / 2, last].map((at) => formatTick(at, data.now))
}

export type StandardTierProps = {
  data: WeightCardData
  onSelectPeriod: (period: WeightPeriod) => void
}

export const StandardTier = reatomMemo<StandardTierProps>(({ data, onSelectPeriod }) => {
  const kg = data.latest.metrics.weight?.value
  if (kg === undefined) return null

  return (
    <div className={styles.standard}>
      <div className={styles.head}>
        <span className={styles.label}>Вес</span>
        <span className={styles.date} data-testid="weight-taken-at">
          {formatTakenAt(data.latest.takenAt, data.now)}
        </span>
      </div>
      <p className={styles.valueRow}>
        <WeightValue kg={kg} size="lg" />
        <DeltaText data={data} className={styles.pushEnd} />
      </p>
      <PeriodControl selected={data.selectedPeriod} onSelect={onSelectPeriod} />
      {data.state === 'ready' ? <SparkTrend data={data} /> : <TrendHole data={data} />}
    </div>
  )
}, 'StandardTier')

export type SparkTrendProps = { data: WeightCardData; className?: string }

/** The sparkline with its max/min labels at the right edge and three date ticks under it. */
export const SparkTrend = reatomMemo<SparkTrendProps>(({ data, className }) => {
  if (!data.bounds) return null
  return (
    <div className={`${styles.trend} ${className ?? ''}`}>
      <div className={styles.sparkRow}>
        <Sparkline
          points={data.points}
          period={data.period}
          height={64}
          className={styles.sparkTall}
        />
        <div className={styles.yLabels} aria-hidden>
          <span>{formatKgValue(data.bounds.max)}</span>
          <span>{formatKgValue(data.bounds.min)}</span>
        </div>
      </div>
      <div className={styles.ticks} aria-hidden>
        {sparklineTicks(data).map((tick, index) => (
          <span key={index}>{tick}</span>
        ))}
      </div>
    </div>
  )
}, 'SparkTrend')
