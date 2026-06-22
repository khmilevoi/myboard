import { reatomMemo } from '@/shared/reatom/reatom-memo'

import type { WeekDayView } from '../view-model'
import { Avatar } from './Avatar'

import styles from './WeekStrip.module.css'

export type WeekStripProps = {
  days: WeekDayView[]
  onSelectDay: (iso: string) => void
}

export const WeekStrip = reatomMemo<WeekStripProps>(({ days, onSelectDay }) => {
  return (
    <div className={styles.root}>
      <div className={styles.grid}>
        {days.map((day) => (
          <button
            key={day.iso}
            type="button"
            className={styles.day}
            data-today={day.isToday}
            data-selected={day.isSelected}
            data-debt={day.isDebtDay}
            data-testid={`week-day-${day.iso}`}
            aria-pressed={day.isSelected}
            onClick={() => onSelectDay(day.iso)}
          >
            {day.isDebtDay ? <span className={styles.dot} aria-hidden /> : null}
            <span className={styles.weekday}>{day.weekday}</span>
            <Avatar person={day.person} size="sm" />
          </button>
        ))}
      </div>
      <div className={styles.legend}>
        <span className={styles.dot} aria-hidden />
        дни гашения долга
      </div>
    </div>
  )
}, 'WeekStrip')
