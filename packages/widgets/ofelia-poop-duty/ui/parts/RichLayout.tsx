import { Cat, ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import { formatWeekRange, pluralizeDays, selectedDaySubtitle } from '../format'
import { useOfelia } from '../ofelia-context'
import { personInitial } from '../person'
import { ActionButtons } from './ActionButtons'
import { Avatar } from './Avatar'
import { AvatarWithBadge } from './AvatarWithBadge'
import { CommentThread } from './CommentThread'
import { HistoryList } from './HistoryList'
import { MobileTabs } from './MobileTabs'
import { OfeliaActionControls } from './OfeliaActionControls'
import { UserToggle } from './UserToggle'
import { WeekStrip } from './WeekStrip'

import styles from './RichLayout.module.css'

export type RichLayoutProps = {
  onExpand?: () => void
  onDelete?: () => void
  onClose?: () => void
}

// Connected columns: each reads only its own stream atom, so an SSE update to
// history or comments re-renders just that column — never the selected-day panel.
const HistoryColumn = reatomMemo(() => {
  const { history } = useOfelia()
  return <HistoryList entries={history()} />
}, 'HistoryColumn')

const CommentsColumn = reatomMemo(() => {
  const { comments, onSend } = useOfelia()
  return <CommentThread comments={comments()} onSend={onSend} />
}, 'CommentsColumn')

export const RichLayout = reatomMemo<RichLayoutProps>(({ onExpand, onDelete, onClose }) => {
  const { view, currentUser, actions, nav } = useOfelia()
  const [tab, setTab] = useState<'history' | 'comments'>('history')
  const selected = view.selected()
  if (!selected) return null

  const balance = view.balance()
  const canForgive = view.canForgive()
  const days = view.days()
  const range = formatWeekRange(days)
  const selectedDay = days.find((day) => day.iso === selected.iso)

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.tile}>
            <Cat size={21} aria-hidden />
          </span>
          <div>
            <div className={styles.titleRow}>
              <span className={styles.title}>Лоток Офелии</span>
              <span className={styles.badge}>large</span>
            </div>
            <div className={styles.subtitle}>Кто убирает за Офелией · чередование</div>
          </div>
        </div>
        <div className={styles.headerActions}>
          <UserToggle value={currentUser()} onChange={actions.onSetUser} />
        </div>
        <OfeliaActionControls
          className={styles.headerClose}
          onExpand={onExpand}
          onDelete={onDelete}
          onClose={onClose}
        />
      </header>

      <div className={styles.body}>
        <section className={styles.panel}>
          <div className={styles.today}>
            <span className={styles.todayAvatarLarge}>
              <AvatarWithBadge
                person={selected.person}
                px={62}
                badge={selectedDay?.debtOwner ? personInitial(selectedDay.debtOwner) : undefined}
                badgeTone={selectedDay?.debtOwner ?? undefined}
              />
            </span>
            <div className={styles.todayMeta}>
              <div className={styles.todayName}>{selected.person}</div>
              <span className={styles.statusChip}>{selectedDaySubtitle(selected, balance)}</span>
            </div>
          </div>

          <div className={styles.actionsDesktop}>
            <ActionButtons
              status={selected.status}
              canUndo={selected.canUndo}
              canForgive={canForgive}
              primaryLabel="Подтвердить уборку"
              inactive={selected.isFuture}
              onConfirm={actions.onConfirm}
              onUndo={actions.onUndo}
              onDebt={actions.onDebt}
              onForgive={actions.onForgive}
            />
          </div>

          <div className={styles.balance}>
            <div className={styles.balanceTitle}>Баланс долга</div>
            {balance.map((entry) => (
              <div key={entry.person} className={styles.balanceRow} data-over={entry.over}>
                <Avatar person={entry.person} size="sm" />
                <span className={styles.balanceName}>{entry.person}</span>
                <span className={styles.balanceValue}>{pluralizeDays(entry.debt)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.detail}>
          <div className={styles.weekNav}>
            <div className={styles.weekTitle}>
              <span className={styles.weekLabel}>Неделя</span>
              <span className={styles.weekRange}>{range}</span>
            </div>
            <div className={styles.weekButtons}>
              <button
                type="button"
                className={styles.navButton}
                aria-label="Прошлая неделя"
                onClick={nav.onPrevWeek}
              >
                <ChevronLeft size={15} aria-hidden />
              </button>
              <button type="button" className={styles.todayButton} onClick={nav.onCurrentWeek}>
                Сегодня
              </button>
              <button
                type="button"
                className={styles.navButton}
                aria-label="Следующая неделя"
                onClick={nav.onNextWeek}
              >
                <ChevronRight size={15} aria-hidden />
              </button>
            </div>
          </div>

          <WeekStrip days={days} onSelectDay={actions.onSelectDay} />

          <MobileTabs className={styles.mobileTabsVisible} tab={tab} onChange={setTab} />

          <div className={styles.split} data-tab={tab}>
            <div className={styles.historyCol}>
              <div className={styles.colLabel}>История</div>
              <HistoryColumn />
            </div>
            <div className={styles.commentsCol}>
              <div className={styles.colLabel}>Комментарии</div>
              <CommentsColumn />
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}, 'RichLayout')
