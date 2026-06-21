import type { HistoryEntryView } from 'widgets/ofelia-poop-duty/model/ofelia-duty'

import { reatomMemo } from '@/shared/reatom/reatom-memo'

import styles from './HistoryList.module.css'

const ACTION_LABEL: Record<HistoryEntryView['type'], string> = {
  cleaned: 'убрал(а)',
  went_into_debt: 'ушёл(ла) в долг',
  forgiven: 'простил(а)',
  cancelled: 'отменил(а)',
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
      {entries.map((entry) => (
        <li key={entry.id} className={styles.item}>
          <span className={styles.avatar} aria-hidden>
            {entry.actor.slice(0, 1)}
          </span>
          <div className={styles.body}>
            <div className={styles.line}>
              <span className={styles.name}>{entry.actor}</span>
              <span className={styles.action}>{ACTION_LABEL[entry.type]}</span>
              {entry.onBehalfOf ? (
                <span className={styles.badge}>за {entry.onBehalfOf}</span>
              ) : null}
            </div>
            <div className={styles.meta}>
              <span className={styles.date}>{entry.date}</span>
              <span className={styles.ip}>{entry.ipTail}</span>
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}, 'HistoryList')
