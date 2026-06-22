import { Cat } from 'lucide-react'

import { reatomMemo } from '@/shared/reatom/reatom-memo'

import { selectedDaySubtitle } from '../format'
import { useOfelia } from '../ofelia-context'
import { ActionButtons } from '../parts/ActionButtons'
import { Avatar } from '../parts/Avatar'
import { DebtChips } from '../parts/DebtChips'
import { UserToggle } from '../parts/UserToggle'

import styles from './StandardTier.module.css'

export const StandardTier = reatomMemo(() => {
  const { view, currentUser, actions } = useOfelia()
  const selected = view.selected()
  if (!selected) return null

  const balance = view.balance()
  const canForgive = view.canForgive()

  return (
    <div className={styles.root}>
      <div className={styles.title}>
        <Cat size={16} aria-hidden />
        Лоток Офелии
      </div>

      <div className={styles.label}>Сегодня убирает</div>
      <div className={styles.who}>
        <Avatar person={selected.person} size="md" />
        <div>
          <div className={styles.name} data-testid="ofelia-duty-person">
            {selected.person}
          </div>
          <div className={styles.sub}>{selectedDaySubtitle(selected, balance)}</div>
        </div>
      </div>

      <div className={styles.divider} />

      <div className={styles.debtRow}>
        <span className={styles.debtLabel}>Долг</span>
        <DebtChips balance={balance} />
      </div>

      <div className={styles.spacer} />

      <div className={styles.footer}>
        <UserToggle value={currentUser()} onChange={actions.onSetUser} />
        <ActionButtons
          status={selected.status}
          canUndo={selected.canUndo}
          canForgive={canForgive}
          onConfirm={actions.onConfirm}
          onUndo={actions.onUndo}
          onDebt={actions.onDebt}
          onForgive={actions.onForgive}
        />
      </div>
    </div>
  )
}, 'StandardTier')
