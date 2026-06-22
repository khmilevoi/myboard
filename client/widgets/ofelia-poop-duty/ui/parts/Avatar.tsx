import type { Person } from 'widgets/ofelia-poop-duty/model/ofelia-duty'

import { reatomMemo } from '@/shared/reatom/reatom-memo'
import { personInitial, personTone } from '../person'

import styles from './Avatar.module.css'

export type AvatarProps = {
  person: Person
  size?: 'sm' | 'md' | 'lg'
}

export const Avatar = reatomMemo<AvatarProps>(({ person, size = 'md' }) => {
  return (
    <span className={styles.avatar} data-tone={personTone(person)} data-size={size} aria-hidden>
      {personInitial(person)}
    </span>
  )
}, 'Avatar')
