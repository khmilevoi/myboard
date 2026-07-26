import { Clock } from 'lucide-react'
import { Fragment, useEffect, useRef } from 'react'
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

// Here the duty circle *is* the subject of the sentence, not an ornament beside a
// written-out name, and `Avatar` is `aria-hidden`. Without the paired text the
// column would announce as bare verbs — "убрал(а)", "простил(а) день" — so every
// circle carries a visually hidden name in the same reading position.
const Phrase = reatomMemo<{ entry: HistoryEntryView }>(
  ({ entry }) => (
    <span className={styles.phrase}>
      {describeEntry(entry).parts.map((part, index) =>
        typeof part === 'string' ? (
          <span key={index}>{part}</span>
        ) : (
          <Fragment key={index}>
            <Avatar person={part.person} px={18} />
            <span className={styles.srOnly}>{part.person}</span>
          </Fragment>
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
      {/* The separating spaces are real text nodes, as in the mock: they keep the
          chips from running into the phrase both visually and when announced. */}
      <div className={styles.action}>
        <Phrase entry={entry} />
        {entry.debtDelta ? (
          <Fragment>
            {' '}
            <span className={styles.debt} data-sign={entry.debtDelta.amount > 0 ? 'up' : 'down'}>
              <Avatar person={entry.debtDelta.person} px={13} />
              <span className={styles.srOnly}>{`${entry.debtDelta.person}: `}</span>
              {entry.debtDelta.amount > 0 ? '+1 день' : '−1 день'}
            </span>
          </Fragment>
        ) : null}
        {superseded ? (
          <Fragment>
            {' '}
            <span className={styles.stale}>перекрыто</span>
          </Fragment>
        ) : null}
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
  /** Duty day highlighted in the week strip. Changing it scrolls that day's
   *  group to the top of the column. */
  selectedDate?: string | null
}

export const HistoryList = reatomMemo<HistoryListProps>(
  ({ groups, today, selectedDate = null }) => {
    const groupNodes = useRef(new Map<string, HTMLElement>())
    const scrolledTo = useRef<string | null>(null)

    // Picking a day in the week strip should reveal that day's records instead
    // of leaving the reader to hunt for them. Pure DOM interop — the selection
    // itself stays in the model — so it belongs here and not in an atom.
    //
    // Only on a *change* of day. The first run just records the mounted
    // selection: scrolling on mount would be wrong in the mobile layout, where
    // the scrollport is the whole dialog body and the panel above the history
    // would be pulled off screen before the reader touched anything.
    //
    // `groups` is a dependency because on first load the day is selected before
    // its group is rendered, so the node the scroll needs does not exist yet.
    useEffect(() => {
      if (!selectedDate) return
      if (scrolledTo.current === selectedDate) return
      const isFirstRun = scrolledTo.current === null
      scrolledTo.current = selectedDate
      if (isFirstRun) return

      // Exactly one ancestor scrolls per layout — the column on desktop, the
      // dialog body on mobile — so the native call cannot drag two scrollports.
      groupNodes.current.get(selectedDate)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }, [selectedDate, groups])

    if (groups.length === 0) return <div className={styles.empty}>Пока нет событий</div>

    return (
      <div className={styles.list}>
        {groups.map((group) => (
          <section
            key={group.dutyDate}
            ref={(node) => {
              if (node) groupNodes.current.set(group.dutyDate, node)
              else groupNodes.current.delete(group.dutyDate)
            }}
            className={styles.group}
            data-duty-date={group.dutyDate}
          >
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
  },
  'HistoryList',
)
