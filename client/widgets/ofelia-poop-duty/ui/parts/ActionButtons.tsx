import { Check, Clock, Minus, Undo2 } from 'lucide-react'

import { reatomMemo } from '@/shared/reatom/reatom-memo'

import styles from './ActionButtons.module.css'

export type ActionButtonsProps = {
  status: 'pending' | 'closed'
  canUndo: boolean
  canForgive: boolean
  compact?: boolean
  alwaysSecondary?: boolean
  onConfirm: () => void
  onUndo: () => void
  onDebt: () => void
  onForgive: () => void
}

export const ActionButtons = reatomMemo<ActionButtonsProps>(
  ({
    status,
    canUndo,
    canForgive,
    compact = false,
    alwaysSecondary = false,
    onConfirm,
    onUndo,
    onDebt,
    onForgive,
  }) => {
    if (compact) {
      return (
        <div className={styles.icons}>
          <button
            type="button"
            className={styles.icon}
            aria-label="Подтвердить уборку"
            onClick={onConfirm}
          >
            <Check size={14} aria-hidden />
          </button>
          <button type="button" className={styles.icon} aria-label="В долг" onClick={onDebt}>
            <Clock size={13} aria-hidden />
          </button>
          <button
            type="button"
            className={styles.icon}
            aria-label="Простить"
            disabled={!canForgive}
            onClick={onForgive}
          >
            <Minus size={13} aria-hidden />
          </button>
        </div>
      )
    }

    const showSecondary = status === 'pending' || alwaysSecondary

    return (
      <div className={styles.stack}>
        {status === 'closed' ? (
          <div className={styles.confirmedRow}>
            <div className={styles.plaque}>
              <Check size={16} aria-hidden />
              Уборка подтверждена
            </div>
            {canUndo ? (
              <button type="button" className={styles.undo} aria-label="Откатить" onClick={onUndo}>
                <Undo2 size={15} aria-hidden />
              </button>
            ) : null}
          </div>
        ) : (
          <button type="button" className={styles.primary} onClick={onConfirm}>
            <Check size={17} aria-hidden />
            Какашки убраны
          </button>
        )}
        {showSecondary ? (
          <div className={styles.secondary}>
            {canForgive ? (
              <button type="button" className={styles.ghost} onClick={onForgive}>
                <Minus size={14} aria-hidden />
                Простить
              </button>
            ) : null}
            <button type="button" className={styles.ghost} onClick={onDebt}>
              <Clock size={15} aria-hidden />
              В долг
            </button>
          </div>
        ) : null}
      </div>
    )
  },
  'ActionButtons',
)
