import { reatomMemo } from '@/shared/reatom/reatom-memo'
import { WidgetControls } from '@/widget-host/ui/WidgetControls'

import { useOfelia } from '../ofelia-context'
import { ActionButtons } from '../parts/ActionButtons'
import { Avatar } from '../parts/Avatar'
import { DebtChips } from '../parts/DebtChips'

import styles from './CompactTier.module.css'

export type CompactTierProps = {
  onExpand?: () => void
  onDelete?: () => void
}

export const CompactTier = reatomMemo<CompactTierProps>(({ onExpand, onDelete }) => {
  const { view, actions } = useOfelia()
  const selected = view.selected()
  if (!selected) return null

  const balance = view.balance()
  const canForgive = view.canForgive()
  const subtitle = selected.isDebtDay ? 'гасит долг' : 'по очереди'

  return (
    <div className={styles.root}>
      <WidgetControls onExpand={onExpand} onDelete={onDelete} />
      <div className={styles.top}>
        <span className={styles.label}>Сегодня убирает</span>
        {selected.isFuture ? null : (
          <ActionButtons
            compact
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

      <div className={styles.who}>
        <Avatar person={selected.person} size="md" />
        <div>
          <div className={styles.name}>{selected.person}</div>
          <div className={styles.sub}>{subtitle}</div>
        </div>
      </div>

      <div className={styles.bottom}>
        <DebtChips balance={balance} />
      </div>
    </div>
  )
}, 'CompactTier')
