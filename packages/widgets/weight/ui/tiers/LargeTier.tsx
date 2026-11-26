import { Weight as WeightIcon } from 'lucide-react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import { type WidgetChrome, WidgetControls } from 'widget-sdk/ui/WidgetControls'

import {
  formatChange,
  formatKg,
  formatTakenAt,
  formatTakenAtFull,
  PERIOD_SUFFIXES,
} from '@/model/format'
import type { WeightCardData, WeightPeriod } from '@/model/weight-view'

import { TrendChart } from '../TrendChart'
import { DeltaText, PeriodControl, SparkTrend, TrendHole, WeightValue } from './StandardTier'

import styles from '../weight.module.css'

export type LargeTierProps = {
  data: WeightCardData
  chrome: WidgetChrome
  onSelectPeriod: (period: WeightPeriod) => void
}

/**
 * The large card and the fullscreen view are one layout: the trend chart beside the list of the
 * period's readings, one column under 680px.
 */
export const LargeTier = reatomMemo<LargeTierProps>(({ data, chrome, onSelectPeriod }) => {
  const kg = data.latest.metrics.weight?.value
  if (kg === undefined) return null

  return (
    <div className={styles.large}>
      <header className={styles.largeHeader}>
        <span className={styles.largeIcon} aria-hidden>
          <WeightIcon />
        </span>
        <h3 className={styles.largeTitle}>Вес</h3>
        <PeriodControl
          selected={data.selectedPeriod}
          onSelect={onSelectPeriod}
          className={styles.largePeriod}
        />
        <WidgetControls {...chrome} placement="inline" />
      </header>
      <div className={styles.largeBody}>
        <section className={styles.largeMain}>
          <div className={styles.largeSummary}>
            <WeightValue kg={kg} size="xl" />
            <span className={styles.date} data-testid="weight-taken-at">
              {formatTakenAt(data.latest.takenAt, data.now)}
            </span>
            <DeltaText data={data} className={styles.pushEnd} />
          </div>
          <div className={styles.largeChart}>
            {data.state === 'ready' ? (
              <>
                {/* Under 680px the axis labels would shrink past legibility, so the narrow
                    layout swaps the chart for the tall sparkline, as the design's phone does. */}
                <div className={styles.chartWide}>
                  <TrendChart points={data.points} period={data.period} now={data.now} />
                </div>
                <SparkTrend data={data} className={styles.chartNarrow} />
              </>
            ) : (
              <TrendHole data={data} />
            )}
          </div>
        </section>
        <section className={styles.largeList} aria-label="Измерения">
          <div className={styles.head}>
            <span className={styles.label}>Измерения</span>
            <span className={styles.date}>
              {data.rows.length} {PERIOD_SUFFIXES[data.period]}
            </span>
          </div>
          <ul className={styles.rows}>
            {data.rows.map((row) => (
              <li key={row.id} className={styles.row} data-testid="weight-row">
                <span>{formatTakenAtFull(row.takenAt, data.now)}</span>
                <span className={styles.rowKg}>{formatKg(row.kg)}</span>
                <span className={styles.rowChange}>
                  {row.change === null ? '' : formatChange(row.change)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}, 'LargeTier')
