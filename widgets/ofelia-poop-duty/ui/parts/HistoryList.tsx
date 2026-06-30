import type { HistoryEntryView } from '@widgets/ofelia-poop-duty/model/ofelia-duty'

import { reatomMemo } from '@/shared/reatom/reatom-memo'

import { personInitial } from '../person'
import { Avatar } from './Avatar'

import styles from './HistoryList.module.css'

function badgeLabel(entry: HistoryEntryView): { text: string; tone: 'accent' | 'forgive' } | null {
  if (entry.type === 'went_into_debt') return { text: 'долг', tone: 'accent' }
  if (entry.type === 'forgiven') return { text: '−1 день', tone: 'forgive' }
  if (entry.type === 'cleaned' && entry.onBehalfOf) {
    return { text: `за ${personInitial(entry.onBehalfOf)}`, tone: 'accent' }
  }
  if (entry.type === 'reset') return { text: 'переоткрыто', tone: 'forgive' }
  return null
}

export type HistoryListProps = {
  entries: HistoryEntryView[]
}

export const HistoryList = reatomMemo<HistoryListProps>(({ entries }) => {
  if (entries.length === 0) {
    return <div className={styles.empty}>Пока нет событий</div>
  }

  return (
    <ul className={styles.list}>
      {entries.map((entry) => {
        const badge = badgeLabel(entry)
        return (
          <li key={entry.id} className={styles.item}>
            <div className={styles.meta}>
              <span className={styles.date}>{entry.date}</span>
              {entry.ipTail ? <span className={styles.ip}>{entry.ipTail}</span> : null}
            </div>
            <div className={styles.row}>
              <Avatar person={entry.actor} px={20} />
              <span className={styles.name}>{entry.actor}</span>
              {badge ? (
                <span className={styles.badge} data-tone={badge.tone}>
                  {badge.text}
                </span>
              ) : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}, 'HistoryList')
