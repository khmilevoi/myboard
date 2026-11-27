import { wrap } from '@reatom/core'
import { Weight } from 'lucide-react'
import { useWidgetContext } from 'widget-runtime'
import { cn } from 'widget-sdk/lib/utils'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import { useCats } from '../cats-context'

import styles from './PassportActions.module.css'

export type PassportActionsProps = {
  /** Opens this mount's "Вес" form; the tier owns it, as the stale note opens it too. */
  onWeigh: () => void
  className?: string
}

/** The passport's quick actions (page 10, standard): "Взвесить" and "Профиль". */
export const PassportActions = reatomMemo<PassportActionsProps>(({ onWeigh, className }) => {
  const { card } = useCats()
  const { requestFullscreen } = useWidgetContext()

  const onProfile = wrap(() => {
    card.tab.set('profile')
    requestFullscreen()
  })

  return (
    <div className={cn(styles.actions, className)}>
      <button type="button" className={styles.primary} onClick={onWeigh}>
        <Weight aria-hidden />
        Взвесить
      </button>
      <button type="button" className={styles.secondary} onClick={onProfile}>
        Профиль
      </button>
    </div>
  )
}, 'CatsPassportActions')
