import { Check } from 'lucide-react'

import { reatomMemo } from '@/shared/reatom/reatom-memo'

import { personInitial } from '../person'
import type { WeekDayView } from '../view-model'
import { AvatarWithBadge } from './AvatarWithBadge'

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
            data-closed={day.isClosed}
            data-testid={`week-day-${day.iso}`}
            aria-pressed={day.isSelected}
            onClick={() => onSelectDay(day.iso)}
          >
            {day.isClosed ? (
              <span className={styles.check} aria-hidden>
                <Check size={12} strokeWidth={3} data-testid="week-day-closed-icon" />
              </span>
            ) : null}
            {day.isToday ? (
              <span className={styles.dot} data-testid="week-day-today-dot" aria-hidden />
            ) : null}
            <span className={styles.weekday}>{day.weekday}</span>
            <AvatarWithBadge
              person={day.person}
              px={26}
              badge={day.debtOwner ? personInitial(day.debtOwner) : undefined}
              badgeTone={day.debtOwner ?? undefined}
            />
          </button>
        ))}
      </div>
      <div className={styles.legend}>
        <span className={styles.dot} aria-hidden />
        текущий день
      </div>
    </div>
  )
}, 'WeekStrip')
