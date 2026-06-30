import { reatomMemo } from '@widget-sdk/reatom/reatom-memo'

import { useOfelia } from '../ofelia-context'
import { Avatar } from '../parts/Avatar'
import { OfeliaMiniHeader } from '../parts/OfeliaMiniHeader'

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
      <OfeliaMiniHeader onExpand={onExpand} onDelete={onDelete} />
      <div className={styles.body}>
        <Avatar person={person} size="lg" />
        <div className={styles.name}>{person}</div>
      </div>
    </div>
  )
}, 'TinyTier')
