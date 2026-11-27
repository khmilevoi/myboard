import type { ReactNode } from 'react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import styles from './hardware.module.css'

export type ConfirmRowProps = {
  /** The question and its consequences; a bold lead is the caller's `<b>`. */
  text: ReactNode
  confirmLabel: string
  onCancel: () => void
  onConfirm: () => void
  /** The request is in flight: both buttons are disabled, so a second click cannot double-submit. */
  busy: boolean
  /** The failure of the last attempt, shown under the buttons. */
  error?: string | null
}

/** The §5 inline confirm: text, «Отмена» and the destructive confirm; stacked on phones. */
export const ConfirmRow = reatomMemo<ConfirmRowProps>(
  ({ text, confirmLabel, onCancel, onConfirm, busy, error = null }) => (
    <div
      className={styles.confirm}
      role="group"
      aria-label="Подтверждение"
      data-testid="hardware-confirm"
    >
      <p className={styles.confirmText}>{text}</p>
      <div className={styles.confirmActions}>
        <button
          type="button"
          className={styles.confirmCancel}
          disabled={busy}
          data-testid="hardware-confirm-cancel"
          onClick={onCancel}
        >
          Отмена
        </button>
        <button
          type="button"
          className={styles.confirmOk}
          disabled={busy}
          data-testid="hardware-confirm-ok"
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
      {error === null ? null : (
        <p className={styles.confirmError} role="alert" data-testid="hardware-action-error">
          {error}
        </p>
      )}
    </div>
  ),
  'ConfirmRow',
)
