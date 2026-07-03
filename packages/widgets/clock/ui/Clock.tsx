import { useWidgetContext } from 'widget-runtime'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import { WidgetControls } from 'widget-sdk/ui/WidgetControls'

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

export const Clock = reatomMemo(() => {
  const { mode, requestFullscreen, requestDelete } = useWidgetContext()
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
      <WidgetControls onExpand={requestFullscreen} onDelete={requestDelete} />
      <span className={styles.timeSmall}>{timeFmt.format(now)}</span>
    </div>
  )
}, 'Clock')
