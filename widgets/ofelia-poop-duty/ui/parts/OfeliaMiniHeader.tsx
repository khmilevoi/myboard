import { Cat } from 'lucide-react'

import { reatomMemo } from '@widget-sdk/reatom/reatom-memo'

import { OfeliaActionControls } from './OfeliaActionControls'

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
      <OfeliaActionControls onExpand={onExpand} onDelete={onDelete} />
    </div>
  )
}, 'OfeliaMiniHeader')
