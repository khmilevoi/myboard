import { reatomMemo } from '@/shared/reatom/reatom-memo'

import { pluralizeDays } from '../format'
import type { DebtBalanceEntry } from '../view-model'
import { Avatar } from './Avatar'

import styles from './DebtChips.module.css'

export type DebtChipsProps = {
  balance: DebtBalanceEntry[]
}

export const DebtChips = reatomMemo<DebtChipsProps>(({ balance }) => {
  const allZero = balance.every((entry) => entry.debt === 0)

  if (allZero) {
    return <span className={styles.even}>баланс ровный · 0 : 0</span>
  }

  return (
    <div className={styles.row}>
      {balance.map((entry) => (
        <span
          key={entry.person}
          className={styles.chip}
          data-over={entry.over}
          data-testid={`debt-chip-${entry.person}`}
        >
          <Avatar person={entry.person} size="sm" />
          <span className={styles.count}>{pluralizeDays(entry.debt)}</span>
        </span>
      ))}
    </div>
  )
}, 'DebtChips')