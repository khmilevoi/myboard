import { Maximize2, Trash2, X } from 'lucide-react'
import { useWidgetContext } from 'widget-runtime'

import { cn } from '../lib/utils'
import { reatomMemo } from '../reatom/reatom-memo'

import styles from './WidgetControls.module.css'

export type WidgetChrome = {
  onExpand?: () => void
  onDelete?: () => void
  onClose?: () => void
}

export type WidgetControlsProps = WidgetChrome & {
  /** `overlay` pins the controls to the card corner; `inline` leaves them in the flow. */
  placement?: 'overlay' | 'inline'
  className?: string
}

/**
 * The card-management chrome a widget draws for itself — expand, delete,
 * close. One implementation for the whole repository; see
 * docs/superpowers/specs/2026-07-27-widget-controls-design.md.
 *
 * Button order is fixed here rather than following prop order, so a given
 * button always occupies the same position across widgets.
 *
 * Visibility is inverted on purpose: see WidgetControls.module.css.
 */
export const WidgetControls = reatomMemo<WidgetControlsProps>(
  ({ onExpand, onDelete, onClose, placement = 'overlay', className }) => {
    if (!onExpand && !onDelete && !onClose) return null

    return (
      <div className={cn(styles.root, className)} data-placement={placement}>
        {onExpand && (
          <button
            type="button"
            className={styles.button}
            aria-label="Развернуть"
            onClick={onExpand}
          >
            <Maximize2 aria-hidden />
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            className={cn(styles.button, styles.destructive)}
            aria-label="Удалить"
            onClick={onDelete}
          >
            <Trash2 aria-hidden />
          </button>
        )}
        {onClose && (
          <button type="button" className={styles.button} aria-label="Закрыть" onClick={onClose}>
            <X aria-hidden />
          </button>
        )}
      </div>
    )
  },
  'WidgetControls',
)

/**
 * The board-card policy behind those callbacks, stated once.
 *
 * `mode === 'large'` is the fullscreen mount (see FullscreenOverlay in the
 * client host), where expanding is meaningless and deleting the card you are
 * looking at is a trap; `mode === 'small'` is the board card, where closing is.
 *
 * This returns the callbacks rather than the rendered buttons because *which*
 * buttons a widget offers stays the widget's decision — passport-checker, for
 * one, deliberately offers no expand affordance at all.
 *
 * The callbacks are already stable and Reatom-bound: the host builds them with
 * `wrap(...)` and hands them through `useEvent(...)` (WidgetFrame.tsx), so
 * neither this hook nor the component re-wraps them.
 */
export const useWidgetChrome = (): WidgetChrome => {
  const { mode, requestFullscreen, requestDelete, requestClose } = useWidgetContext()

  if (mode === 'large') return { onClose: requestClose }
  return { onExpand: requestFullscreen, onDelete: requestDelete }
}
