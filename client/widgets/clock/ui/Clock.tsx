import { reatomMemo } from '../../../src/shared/reatom/reatom-memo'
import type { WidgetRuntimeProps } from '../../../src/widget-host/model/types'
import { clockNow } from '../model/clock-model'
import styles from './clock.module.css'

const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

const dateFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
})

export const Clock = reatomMemo<WidgetRuntimeProps>(({ mode }) => {
  const now = clockNow()

  if (mode === 'large') {
    return (
      <div className={styles.root}>
        <div className={styles.timeLarge}>{timeFmt.format(now)}</div>
        <div className={styles.date}>{dateFmt.format(now)}</div>
      </div>
    )
  }

  return (
    <div className={styles.smallButton}>
      <span className={styles.timeSmall}>{timeFmt.format(now)}</span>
    </div>
  )
}, 'Clock')
