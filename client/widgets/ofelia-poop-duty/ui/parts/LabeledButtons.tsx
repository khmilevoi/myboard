import { Check, Clock, Minus, Undo2 } from 'lucide-react'

import { reatomMemo } from '@/shared/reatom/reatom-memo'

import styles from './LabeledButtons.module.css'

export type LabeledButtonsProps = {
  status: 'pending' | 'closed'
  canUndo: boolean
  canForgive: boolean
  inactive?: boolean
  primaryLabel?: string
  showNotes?: boolean
  onConfirm: () => void
  onUndo: () => void
  onDebt: () => void
  onForgive: () => void
}

export const LabeledButtons = reatomMemo<LabeledButtonsProps>(
  ({
    status,
    canUndo,
    canForgive,
    inactive = false,
    primaryLabel = 'Какашки убраны',
    showNotes = false,
    onConfirm,
    onUndo,
    onDebt,
    onForgive,
  }) => {
    const confirmed = status === 'closed' && !inactive

    return (
      <div className={styles.stack} data-inactive={inactive}>
        {confirmed ? (
          <div className={styles.confirmedRow}>
            <div className={styles.plaque}>
              <Check size={16} aria-hidden />
              Уборка подтверждена
            </div>
            {canUndo ? (
              <button type="button" className={styles.undo} aria-label="Откатить" onClick={onUndo} disabled={inactive}>
                <Undo2 size={15} aria-hidden />
              </button>
            ) : null}
          </div>
        ) : (
          <button type="button" className={styles.primary} onClick={onConfirm} disabled={inactive}>
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

        <div className={styles.secondary} data-disabled={confirmed || inactive}>
          <button
            type="button"
            className={styles.ghost}
            onClick={onDebt}
            disabled={confirmed || inactive}
          >
            <Clock size={14} aria-hidden />
            В долг
          </button>
          <button
            type="button"
            className={styles.forgive}
            onClick={onForgive}
            disabled={confirmed || inactive || !canForgive}
          >
            <Minus size={14} aria-hidden />
            Простить
          </button>
        </div>

        {showNotes ? (
          <div className={styles.inactiveNote}>
            <span className={styles.noteDot} aria-hidden />
            неактивны для других дней
          </div>
        ) : null}
      </div>
    )
  },
  'LabeledButtons',
)
