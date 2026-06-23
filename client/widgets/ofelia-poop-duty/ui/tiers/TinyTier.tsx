import { reatomMemo } from '@/shared/reatom/reatom-memo'
import { WidgetControls } from '@/widget-host/ui/WidgetControls'

import { useOfelia } from '../ofelia-context'
import { Avatar } from '../parts/Avatar'

import styles from './TinyTier.module.css'

export type TinyTierProps = {
  onExpand?: () => void
  onDelete?: () => void
}

export const TinyTier = reatomMemo<TinyTierProps>(({ onExpand, onDelete }) => {
  // Reads only the primitive `selectedPerson` → re-renders solely on a name change.
  const person = useOfelia().view.selectedPerson()
  if (!person) return null

  return (
    <div className={styles.root}>
      <WidgetControls onExpand={onExpand} onDelete={onDelete} />
      <Avatar person={person} size="lg" />
      <div className={styles.name}>{person}</div>
    </div>
  )
}, 'TinyTier')
