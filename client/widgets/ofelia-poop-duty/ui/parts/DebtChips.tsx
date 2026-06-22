import { reatomMemo } from '@/shared/reatom/reatom-memo'

import type { DebtBalanceEntry } from '../view-model'
import { Avatar } from './Avatar'

import styles from './DebtChips.module.css'

export type DebtChipsProps = {
  balance: DebtBalanceEntry[]
}

export const DebtChips = reatomMemo<DebtChipsProps>(({ balance }) => {
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
          <span className={styles.count}>{entry.debt}</span>
        </span>
      ))}
    </div>
  )
}, 'DebtChips')
