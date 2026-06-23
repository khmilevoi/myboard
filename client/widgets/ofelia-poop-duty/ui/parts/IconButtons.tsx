import { Check, Clock, Minus } from 'lucide-react'

import { reatomMemo } from '@/shared/reatom/reatom-memo'

import styles from './IconButtons.module.css'

export type IconButtonsProps = {
  canForgive: boolean
  onConfirm: () => void
  onDebt: () => void
  onForgive: () => void
}

export const IconButtons = reatomMemo<IconButtonsProps>(
  ({ canForgive, onConfirm, onDebt, onForgive }) => {
    return (
      <div className={styles.icons}>
        <button
          type="button"
          className={styles.icon}
          data-tone="confirm"
          aria-label="Подтвердить уборку"
          onClick={onConfirm}
        >
          <Check size={14} aria-hidden />
        </button>
        <button
          type="button"
          className={styles.icon}
          data-tone="debt"
          aria-label="В долг"
          onClick={onDebt}
        >
          <Clock size={13} aria-hidden />
        </button>
        <button
          type="button"
          className={styles.icon}
          data-tone="forgive"
          aria-label="Простить"
          disabled={!canForgive}
          onClick={onForgive}
        >
          <Minus size={13} aria-hidden />
        </button>
      </div>
    )
  },
  'IconButtons',
)
