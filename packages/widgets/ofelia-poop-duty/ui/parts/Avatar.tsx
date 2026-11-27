import type { Person } from 'module-cats/domain/roster'
import { AVATAR_INITIAL_RATIO } from 'module-cats/ui/MemberAvatar'
import { personInitial, personTone } from 'module-cats/ui/person'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import styles from './Avatar.module.css'

export type AvatarProps = {
  person: Person
  size?: 'sm' | 'md' | 'lg'
  px?: number
}

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
