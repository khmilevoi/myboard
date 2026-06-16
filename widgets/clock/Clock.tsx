import { useEffect, useState } from 'react'
import { Maximize2, X } from 'lucide-react'
import type { WidgetClient, WidgetMode } from '../../src/shared/widget-bridge'
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

export function Clock({ client }: { client: WidgetClient }) {
  const [mode, setMode] = useState<WidgetMode>(client.mode)
  useEffect(() => client.onModeChange(setMode), [client])
  const now = useNow()

  if (mode === 'large') {
    return (
      <div className={styles.root}>
        <button className={styles.close} aria-label="Close" onClick={() => client.requestClose()}>
          <X size={18} aria-hidden />
        </button>
        <div className={styles.timeLarge}>{timeFmt.format(now)}</div>
        <div className={styles.date}>{dateFmt.format(now)}</div>
      </div>
    )
  }

  return (
    <button
      className={styles.smallButton}
      title="Open fullscreen"
      onClick={() => client.requestFullscreen()}
    >
      <span className={styles.timeSmall}>{timeFmt.format(now)}</span>
      <Maximize2 className={styles.smallExpand} size={14} aria-hidden />
    </button>
  )
}
