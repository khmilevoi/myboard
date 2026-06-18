import { useEffect, useState } from 'react'
import type { WidgetRuntimeProps } from '../../src/widget-host/types'
import { formatDutyDate, getOfeliaDutySummary, getWarsawDateKey } from './ofelia-duty'
import styles from './ofelia-poop-duty.module.css'

const WARSAW_DATE_LOOKAHEAD_MS = 30 * 60 * 60 * 1000
const WARSAW_DATE_CHANGE_CUSHION_MS = 1000

function findNextWarsawDateChange(now: Date): Date {
  const currentDateKey = getWarsawDateKey(now)
  const start = now.getTime()
  let low = start
  let high = start + WARSAW_DATE_LOOKAHEAD_MS

  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2)
    const middleDateKey = getWarsawDateKey(new Date(middle))

    if (middleDateKey === currentDateKey) {
      low = middle
    } else {
      high = middle
    }
  }

  return new Date(high)
}

function useNow(): Date {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const nextDateChange = findNextWarsawDateChange(now)
    const delay = Math.max(0, nextDateChange.getTime() - Date.now() + WARSAW_DATE_CHANGE_CUSHION_MS)
    const id = setTimeout(() => setNow(new Date()), delay)

    return () => clearTimeout(id)
  }, [now])

  return now
}

export function OfeliaPoopDuty({ mode }: WidgetRuntimeProps) {
  const now = useNow()
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
}
