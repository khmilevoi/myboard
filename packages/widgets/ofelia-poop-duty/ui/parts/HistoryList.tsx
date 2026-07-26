import { Clock } from 'lucide-react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import type { HistoryDayGroup, HistoryEntryView } from '@/model/history-view'

import { pluralizeRecords } from '../format'
import {
  describeEntry,
  formatDutyDay,
  formatRecordedDate,
  formatTimeOfDay,
  formatWeekdayShort,
} from '../history-format'
import { Avatar } from './Avatar'
import { MemberAvatar } from './MemberAvatar'

import styles from './HistoryList.module.css'

const authorName = (entry: HistoryEntryView): string => {
  if (entry.recordedBy.kind === 'account') return entry.recordedBy.name
  if (entry.recordedBy.kind === 'person') return entry.recordedBy.person
  return 'автор неизвестен'
}

const Phrase = reatomMemo<{ entry: HistoryEntryView }>(
  ({ entry }) => (
    <span className={styles.phrase}>
      {describeEntry(entry).parts.map((part, index) =>
        typeof part === 'string' ? (
          <span key={index}>{part}</span>
        ) : (
          <Avatar key={index} person={part.person} px={18} />
        ),
      )}
    </span>
  ),
  'HistoryPhrase',
)

const Entry = reatomMemo<{ entry: HistoryEntryView; superseded?: boolean }>(
  ({ entry, superseded = false }) => (
    <div
      className={styles.entry}
      data-superseded={superseded}
      {...(superseded ? { 'data-testid': `history-superseded-${entry.id}` } : {})}
    >
      <div className={styles.action}>
        <Phrase entry={entry} />
        {entry.debtDelta ? (
          <span className={styles.debt} data-sign={entry.debtDelta.amount > 0 ? 'up' : 'down'}>
            <Avatar person={entry.debtDelta.person} px={13} />
            {entry.debtDelta.amount > 0 ? '+1 день' : '−1 день'}
          </span>
        ) : null}
        {superseded ? <span className={styles.stale}>перекрыто</span> : null}
      </div>
      <div className={styles.signature}>
        <MemberAvatar author={entry.recordedBy} isViewer={entry.isViewerRecord} px={18} />
        <span className={styles.signatureName} data-unknown={entry.recordedBy.kind === 'unknown'}>
          {entry.recordedBy.kind === 'unknown'
            ? 'автор неизвестен'
            : `отметил(а) ${authorName(entry)}`}
        </span>
        {entry.recordedBy.kind === 'person' ? (
          <span className={styles.legacy}>без аккаунта</span>
        ) : null}
        {entry.recordedLate ? (
          <span className={styles.late} title="отметка сделана позже дня дежурства">
            <Clock size={9} aria-hidden />
            {formatRecordedDate(entry.recordedAt)}
          </span>
        ) : null}
        <span className={styles.time}>{formatTimeOfDay(entry.recordedAt)}</span>
      </div>
    </div>
  ),
  'HistoryEntry',
)

export type HistoryListProps = {
  groups: HistoryDayGroup[]
  today: string | null
}

export const HistoryList = reatomMemo<HistoryListProps>(({ groups, today }) => {
  if (groups.length === 0) return <div className={styles.empty}>Пока нет событий</div>

  return (
    <div className={styles.list}>
      {groups.map((group) => (
        <section key={group.dutyDate} className={styles.group}>
          <header className={styles.groupHeader}>
            <span className={styles.groupDay}>{formatDutyDay(group.dutyDate, today)}</span>
            <span className={styles.groupWeekday}>{formatWeekdayShort(group.dutyDate)}</span>
            <span className={styles.groupRule} />
            {group.superseded.length > 0 ? (
              <span className={styles.groupCount}>
                {pluralizeRecords(group.superseded.length + 1)}
              </span>
            ) : null}
          </header>
          <Entry entry={group.current} />
          {group.superseded.length > 0 ? (
            <div className={styles.supersededRail}>
              {group.superseded.map((entry) => (
                <Entry key={entry.id} entry={entry} superseded />
              ))}
            </div>
          ) : null}
        </section>
      ))}
    </div>
  )
}, 'HistoryList')
