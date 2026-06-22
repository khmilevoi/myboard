import { reatomMemo } from '@/shared/reatom/reatom-memo'

import { useOfelia } from '../ofelia-context'
import { Avatar } from '../parts/Avatar'

import styles from './TinyTier.module.css'

export const TinyTier = reatomMemo(() => {
  // Reads only the primitive `selectedPerson` → re-renders solely on a name change.
  const person = useOfelia().view.selectedPerson()
  if (!person) return null

  return (
    <div className={styles.root}>
      <Avatar person={person} size="lg" />
      <div className={styles.name}>{person}</div>
    </div>
  )
}, 'TinyTier')