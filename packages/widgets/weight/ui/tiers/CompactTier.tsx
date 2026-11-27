import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import { formatTakenAt } from '@/model/format'
import type { WeightCardData } from '@/model/weight-view'

import { Sparkline } from '../Sparkline'
import { DeltaText, TrendHole, WeightValue } from './StandardTier'

import styles from '../weight.module.css'

export type CompactTierProps = { data: WeightCardData }

/** The number, its change and a sparkline — always over 30 days, there is no period control. */
export const CompactTier = reatomMemo<CompactTierProps>(({ data }) => {
  const kg = data.latest.metrics.weight?.value
  if (kg === undefined) return null

  return (
    <div className={styles.compact}>
      <div className={styles.head}>
        <span className={styles.label}>Вес</span>
        <span className={styles.date} data-testid="weight-taken-at">
          {formatTakenAt(data.latest.takenAt, data.now)}
        </span>
      </div>
      <div>
        <p className={styles.valueRow}>
          <WeightValue kg={kg} size="md" />
        </p>
        <DeltaText data={data} className={styles.deltaBelow} />
        {data.state === 'ready' ? (
          <Sparkline
            points={data.points}
            period={data.period}
            height={28}
            className={styles.sparkShort}
          />
        ) : (
          // No period control here, so "choose a longer period" would point at nothing.
          <TrendHole data={data} hint={false} />
        )}
      </div>
    </div>
  )
}, 'CompactTier')
