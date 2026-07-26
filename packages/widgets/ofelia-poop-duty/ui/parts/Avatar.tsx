import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import type { Person } from '@/domain/roster'

import { personInitial, personTone } from '../person'

import styles from './Avatar.module.css'

export type AvatarProps = {
  person: Person
  size?: 'sm' | 'md' | 'lg'
  px?: number
}

/**
 * Initial size as a fraction of the avatar box, shared with `MemberAvatar`. A
 * duty circle and an account square are rendered side by side at the same `px`
 * in the history phrase, so a ratio that differs between them reads as two
 * mismatched type sizes on one line.
 */
export const AVATAR_INITIAL_RATIO = 0.4

export const Avatar = reatomMemo<AvatarProps>(({ person, size = 'md', px }) => {
  const style = px
    ? { width: `${px}px`, height: `${px}px`, fontSize: `${px * AVATAR_INITIAL_RATIO}px` }
    : undefined
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
