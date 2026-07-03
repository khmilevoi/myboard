import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import { useAtomValue } from 'widget-sdk/reatom/use-atom-value'

import { otherPerson } from '@/model/ofelia-duty'

import { selectedDaySubtitle } from '../format'
import { useOfelia } from '../ofelia-context'
import { ActionButtons } from '../parts/ActionButtons'
import { Avatar } from '../parts/Avatar'
import { DebtChips } from '../parts/DebtChips'
import { OfeliaMiniHeader } from '../parts/OfeliaMiniHeader'

import styles from './StandardTier.module.css'

export type StandardTierProps = {
  onExpand?: () => void
  onDelete?: () => void
}

export const StandardTier = reatomMemo<StandardTierProps>(({ onExpand, onDelete }) => {
  const { view, actions } = useOfelia()
  // Day status and debt balance load asynchronously on mount (history + debts).
  // Read them race-free (useSyncExternalStore) so a warm server's response that
  // lands in the render→subscribe window isn't dropped, leaving a stale card.
  // Hooks must run unconditionally, so read every slice before the guard.
  const selected = useAtomValue(view.selected)
  const balance = useAtomValue(view.balance)
  const canForgive = useAtomValue(view.canForgive)
  if (!selected) return null

  return (
    <div className={styles.root}>
      <OfeliaMiniHeader onExpand={onExpand} onDelete={onDelete} />

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

      <p className={styles.hint}>
        Не успеваешь? Уберёт {otherPerson(selected.person)}, а тебе +1 день долга.
      </p>

      <ActionButtons
        status={selected.status}
        canUndo={selected.canUndo}
        canForgive={canForgive}
        inactive={selected.isFuture}
        onConfirm={actions.onConfirm}
        onUndo={actions.onUndo}
        onDebt={actions.onDebt}
        onForgive={actions.onForgive}
      />
    </div>
  )
}, 'StandardTier')
