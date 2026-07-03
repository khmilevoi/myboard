import { Check, Clock, Minus, Undo2 } from 'lucide-react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import styles from './IconButtons.module.css'

export type IconButtonsProps = {
  className?: string
  status: 'pending' | 'closed'
  canUndo: boolean
  canForgive: boolean
  inactive?: boolean
  onConfirm: () => void
  onUndo: () => void
  onDebt: () => void
  onForgive: () => void
}

export const IconButtons = reatomMemo<IconButtonsProps>(
  ({
    className,
    status,
    canUndo,
    canForgive,
    inactive = false,
    onConfirm,
    onUndo,
    onDebt,
    onForgive,
  }) => {
    const confirmed = status === 'closed' && !inactive

    return (
      <div className={className ? `${styles.icons} ${className}` : styles.icons}>
        <button
          type="button"
          className={styles.icon}
          data-tone={confirmed ? 'undo' : 'confirm'}
          aria-label={confirmed ? 'Откатить' : 'Подтвердить уборку'}
          disabled={inactive || (confirmed && !canUndo)}
          onClick={confirmed ? onUndo : onConfirm}
        >
          {confirmed ? <Undo2 size={14} aria-hidden /> : <Check size={14} aria-hidden />}
        </button>
        <button
          type="button"
          className={styles.icon}
          data-tone="debt"
          aria-label="В долг"
          disabled={confirmed || inactive}
          onClick={onDebt}
        >
          <Clock size={13} aria-hidden />
        </button>
        <button
          type="button"
          className={styles.icon}
          data-tone="forgive"
          aria-label="Простить"
          disabled={confirmed || inactive || !canForgive}
          onClick={onForgive}
        >
          <Minus size={13} aria-hidden />
        </button>
      </div>
    )
  },
  'IconButtons',
)
