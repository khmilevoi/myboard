import { reatomMemo } from '../../../src/shared/reatom/reatom-memo'
import type { WidgetRuntimeProps } from '../../../src/widget-host/model/types'
import { formatDutyDate, getOfeliaDutySummary } from '../model/ofelia-duty'
import { ofeliaNow } from '../model/ofelia-poop-duty-model'
import styles from './ofelia-poop-duty.module.css'

export const OfeliaPoopDuty = reatomMemo<WidgetRuntimeProps>(({ mode }) => {
  const now = ofeliaNow()
  const duty = getOfeliaDutySummary(now)

  if (mode === 'large') {
    return (
      <section className={styles.root}>
        <div className={styles.label}>Сегодня</div>
        <h1 className={styles.title}>Кто сегодня убирает какахи Офелии</h1>
        <div className={styles.person}>{duty.today}</div>
        <div className={styles.tomorrow}>Завтра: {duty.tomorrow}</div>
        <div className={styles.meta}>{formatDutyDate(now)}</div>
      </section>
    )
  }

  return (
    <section className={styles.small}>
      <div className={styles.label}>Сегодня убирает</div>
      <div className={styles.person}>{duty.today}</div>
      <div className={styles.smallTomorrow}>Завтра: {duty.tomorrow}</div>
    </section>
  )
}, 'OfeliaPoopDuty')
