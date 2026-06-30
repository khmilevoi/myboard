import { Maximize2, X } from 'lucide-react'

import { reatomMemo } from '@/shared/reatom/reatom-memo'

import styles from './OfeliaActionControls.module.css'

export type OfeliaActionControlsProps = {
  onExpand?: () => void
  onDelete?: () => void
  onClose?: () => void
  className?: string
}

export const OfeliaActionControls = reatomMemo<OfeliaActionControlsProps>(
  ({ onExpand, onDelete, onClose, className }) => {
    if (!onExpand && !onDelete && !onClose) return null

    return (
      <div className={className ? `${styles.root} ${className}` : styles.root}>
        {onExpand ? (
          <button
            type="button"
            className={styles.button}
            aria-label="Развернуть"
            onClick={onExpand}
          >
            <Maximize2 size={17} aria-hidden />
          </button>
        ) : null}
        {onDelete ? (
          <button type="button" className={styles.button} aria-label="Удалить" onClick={onDelete}>
            <X size={17} aria-hidden />
          </button>
        ) : null}
        {onClose ? (
          <button type="button" className={styles.button} aria-label="Закрыть" onClick={onClose}>
            <X size={17} aria-hidden />
          </button>
        ) : null}
      </div>
    )
  },
  'OfeliaActionControls',
)
