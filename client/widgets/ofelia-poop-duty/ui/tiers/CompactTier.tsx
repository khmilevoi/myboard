import { reatomMemo } from '@/shared/reatom/reatom-memo'

import { useOfelia } from '../ofelia-context'
import { ActionButtons } from '../parts/ActionButtons'
import { Avatar } from '../parts/Avatar'
import { DebtChips } from '../parts/DebtChips'
import { UserToggle } from '../parts/UserToggle'

import styles from './CompactTier.module.css'

export const CompactTier = reatomMemo(() => {
  const { view, currentUser, actions } = useOfelia()
  const selected = view.selected()
  if (!selected) return null

  const balance = view.balance()
  const canForgive = view.canForgive()
  const subtitle = selected.isDebtDay ? 'гасит долг' : 'по очереди'

  return (
    <div className={styles.root}>
      <div className={styles.top}>
        <span className={styles.label}>Сегодня убирает</span>
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
        <UserToggle value={currentUser()} onChange={actions.onSetUser} />
      </div>
    </div>
  )
}, 'CompactTier')
