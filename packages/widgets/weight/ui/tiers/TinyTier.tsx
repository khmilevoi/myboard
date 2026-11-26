import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import { formatTakenOn } from '@/model/format'
import type { WeightCardData } from '@/model/weight-view'

import { WeightValue } from './StandardTier'

import styles from '../weight.module.css'

export type TinyTierProps = { data: WeightCardData }

/** How much and when: the number and the day, nothing else. */
export const TinyTier = reatomMemo<TinyTierProps>(({ data }) => {
  const kg = data.latest.metrics.weight?.value
  if (kg === undefined) return null

  return (
    <div className={styles.tiny}>
      <span className={styles.label}>Вес</span>
      <WeightValue kg={kg} size="md" />
      <span className={styles.small} data-testid="weight-taken-at">
        {formatTakenOn(data.latest.takenAt, data.now)}
      </span>
    </div>
  )
}, 'TinyTier')
