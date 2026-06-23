import { Cat } from 'lucide-react'

import { reatomMemo } from '@/shared/reatom/reatom-memo'
import { useAtomValue } from '@/shared/reatom/use-atom-value'
import { WidgetControls } from '@/widget-host/ui/WidgetControls'

import { selectedDaySubtitle } from '../format'
import { useOfelia } from '../ofelia-context'
import { ActionButtons } from '../parts/ActionButtons'
import { Avatar } from '../parts/Avatar'
import { DebtChips } from '../parts/DebtChips'
import { UserToggle } from '../parts/UserToggle'

import styles from './StandardTier.module.css'

export type StandardTierProps = {
  onExpand?: () => void
  onDelete?: () => void
}

export const StandardTier = reatomMemo<StandardTierProps>(({ onExpand, onDelete }) => {
  const { view, currentUser, actions } = useOfelia()
  // Day status and debt balance load asynchronously on mount (history + debts).
  // Read them race-free (useSyncExternalStore) so a warm server's response that
  // lands in the render→subscribe window isn't dropped, leaving a stale card.
  // Hooks must run unconditionally, so read every slice before the guard.
  const selected = useAtomValue(view.selected)
  const balance = useAtomValue(view.balance)
  const canForgive = useAtomValue(view.canForgive)
  const user = useAtomValue(currentUser)
  if (!selected) return null

  return (
    <div className={styles.root}>
      <WidgetControls onExpand={onExpand} onDelete={onDelete} />
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
        <UserToggle value={user} onChange={actions.onSetUser} />
        {selected.isFuture ? null : (
          <ActionButtons
            status={selected.status}
            canUndo={selected.canUndo}
            canForgive={canForgive}
            onConfirm={actions.onConfirm}
            onUndo={actions.onUndo}
            onDebt={actions.onDebt}
            onForgive={actions.onForgive}
          />
        )}
      </div>
    </div>
  )
}, 'StandardTier')
