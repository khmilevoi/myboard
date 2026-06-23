import { Maximize2, X } from 'lucide-react'

import { reatomMemo } from '@/shared/reatom/reatom-memo'

import styles from './WidgetControls.module.css'

export type WidgetControlsProps = {
  onExpand?: () => void
  onDelete?: () => void
}

// Hover-revealed corner overlay a widget renders itself, wired to the
// requestFullscreen/requestDelete callbacks it already receives as runtime
// props. `widget-controls` is a stable global hook WidgetFrame.module.css
// uses to reveal it on `.frame:hover`/`:focus-within`.
export const WidgetControls = reatomMemo<WidgetControlsProps>(({ onExpand, onDelete }) => {
  if (!onExpand && !onDelete) return null

  return (
    <div className={`${styles.root} widget-controls`}>
      {onExpand && (
        <button
          type="button"
          className={styles.button}
          aria-label="Развернуть"
          onClick={onExpand}
        >
          <Maximize2 size={15} aria-hidden />
        </button>
      )}
      {onDelete && (
        <button type="button" className={styles.button} aria-label="Удалить" onClick={onDelete}>
          <X size={15} aria-hidden />
        </button>
      )}
    </div>
  )
}, 'WidgetControls')
