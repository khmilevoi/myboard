import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import { selectedDaySubtitle } from '../format'
import { useOfelia } from '../ofelia-context'
import { ActionButtons } from '../parts/ActionButtons'
import { Avatar } from '../parts/Avatar'
import { OfeliaMiniHeader } from '../parts/OfeliaMiniHeader'

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
  const subtitle = selectedDaySubtitle(selected, balance)

  return (
    <div className={styles.root}>
      <OfeliaMiniHeader onExpand={onExpand} onDelete={onDelete} />
      <div className={styles.hero}>
        <Avatar person={selected.person} size="md" />
        <div className={styles.copy}>
          <div className={styles.name}>{selected.person}</div>
          <div className={styles.sub}>{subtitle}</div>
        </div>
      </div>

      {selected.isFuture ? null : (
        <ActionButtons
          className={styles.actions}
          status={selected.status}
          canUndo={selected.canUndo}
          canForgive={canForgive}
          debtLabel="Отложить"
          forgiveLabel="Простить"
          onConfirm={actions.onConfirm}
          onUndo={actions.onUndo}
          onDebt={actions.onDebt}
          onForgive={actions.onForgive}
        />
      )}
    </div>
  )
}, 'CompactTier')
