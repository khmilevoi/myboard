import { Check, Clock, Minus, Undo2 } from 'lucide-react'

import { reatomMemo } from '@/shared/reatom/reatom-memo'

import styles from './LabeledButtons.module.css'

export type LabeledButtonsProps = {
  className?: string
  status: 'pending' | 'closed'
  canUndo: boolean
  canForgive: boolean
  inactive?: boolean
  primaryLabel?: string
  debtLabel?: string
  forgiveLabel?: string
  showNotes?: boolean
  onConfirm: () => void
  onUndo: () => void
  onDebt: () => void
  onForgive: () => void
}

export const LabeledButtons = reatomMemo<LabeledButtonsProps>(
  ({
    className,
    status,
    canUndo,
    canForgive,
    inactive = false,
    primaryLabel = 'Какашки убраны',
    debtLabel = 'В долг',
    forgiveLabel = 'Простить',
    showNotes = false,
    onConfirm,
    onUndo,
    onDebt,
    onForgive,
  }) => {
    const confirmed = status === 'closed' && !inactive

    return (
      <div
        className={className ? `${styles.stack} ${className}` : styles.stack}
        data-inactive={inactive}
        data-slot="labeled-buttons"
      >
        {confirmed ? (
          <div className={styles.confirmedRow}>
            <div className={styles.plaque}>
              <Check size={16} aria-hidden />
              Уборка подтверждена
            </div>
            {canUndo ? (
              <button
                type="button"
                className={styles.undo}
                aria-label="Откатить"
                onClick={onUndo}
                disabled={inactive}
              >
                <Undo2 size={15} aria-hidden />
              </button>
            ) : null}
          </div>
        ) : (
          <button
            type="button"
            className={styles.primary}
            data-slot="primary"
            onClick={onConfirm}
            disabled={inactive}
          >
            <Check size={17} aria-hidden />
            {primaryLabel}
          </button>
        )}

        {showNotes && confirmed && canUndo ? (
          <div className={styles.undoNote}>
            <Undo2 size={10} aria-hidden />
            анду · только сегодня
          </div>
        ) : null}

        <div
          className={styles.secondary}
          data-slot="secondary"
          data-disabled={confirmed || inactive}
        >
          <button
            type="button"
            className={styles.ghost}
            data-slot="debt"
            onClick={onDebt}
            disabled={confirmed || inactive}
          >
            <Clock size={14} aria-hidden />
            {debtLabel}
          </button>
          <button
            type="button"
            className={styles.forgive}
            data-slot="forgive"
            onClick={onForgive}
            disabled={confirmed || inactive || !canForgive}
          >
            <Minus size={14} aria-hidden />
            {forgiveLabel}
          </button>
        </div>
      </div>
    )
  },
  'LabeledButtons',
)
