import type { ReactNode } from 'react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import { WidgetControls, type WidgetChrome } from 'widget-sdk/ui/WidgetControls'

import styles from './CatCardHeader.module.css'

export type CatCardHeaderProps = {
  icon: ReactNode
  title: string
  /** A `CatSwitcher`, or null where the card shows none. */
  switcher: ReactNode | null
  /**
   * From `useWidgetChrome()`, minus `onExpand` while the card is not ready: the controls are drawn
   * in every state, and "Удалить" is always among them on the board.
   */
  chrome: WidgetChrome
}

/**
 * The header row of every litter, stats and food card: icon, title, switcher, then the card
 * controls inline at its end. The title wraps to two lines rather than being cut to one.
 */
export const CatCardHeader = reatomMemo<CatCardHeaderProps>(({ icon, title, switcher, chrome }) => {
  return (
    <div className={styles.header}>
      {icon && <span className={styles.icon}>{icon}</span>}
      <h2 className={styles.title}>{title}</h2>
      {switcher}
      <WidgetControls placement="inline" {...chrome} />
    </div>
  )
}, 'CatCardHeader')
