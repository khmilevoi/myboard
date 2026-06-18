import { useEffect, useState } from 'react'
import type { WidgetRuntimeProps } from '../../src/widget-host/types'
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

function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

export function Clock({ mode }: WidgetRuntimeProps) {
  const now = useNow()

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
}
