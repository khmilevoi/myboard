import type { Person } from '@/model/ofelia-duty'

import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import { personInitial, personTone } from '../person'

import styles from './Avatar.module.css'

export type AvatarProps = {
  person: Person
  size?: 'sm' | 'md' | 'lg'
  px?: number
}

export const Avatar = reatomMemo<AvatarProps>(({ person, size = 'md', px }) => {
  const style = px ? { width: `${px}px`, height: `${px}px`, fontSize: `${px * 0.4}px` } : undefined
  return (
    <span
      className={styles.avatar}
      data-tone={personTone(person)}
      data-size={size}
      style={style}
      aria-hidden
    >
      {personInitial(person)}
    </span>
  )
}, 'Avatar')
