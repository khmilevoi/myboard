import { Cat } from 'lucide-react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import { WidgetControls } from 'widget-sdk/ui/WidgetControls'

import styles from './OfeliaMiniHeader.module.css'

export type OfeliaMiniHeaderProps = {
  onExpand?: () => void
  onDelete?: () => void
}

export const OfeliaMiniHeader = reatomMemo<OfeliaMiniHeaderProps>(({ onExpand, onDelete }) => {
  return (
    <div className={styles.root}>
      <div className={styles.title}>
        <Cat size={16} aria-hidden />
        <span className={styles.titleText}>Лоток Офелии</span>
      </div>
      {/* Inline: this header is the widget's own chrome row, so the controls
          belong in its flow rather than floating over the card corner. */}
      <WidgetControls placement="inline" onExpand={onExpand} onDelete={onDelete} />
    </div>
  )
}, 'OfeliaMiniHeader')
