import type { Person } from 'module-cats/domain/roster'
import { personTone } from 'module-cats/ui/person'
import type { ReactNode } from 'react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import { Avatar } from './Avatar'

import styles from './AvatarWithBadge.module.css'

export type AvatarWithBadgeProps = {
  person: Person
  px?: number
  badge?: ReactNode
  badgeTone?: Person
}

export const AvatarWithBadge = reatomMemo<AvatarWithBadgeProps>(
  ({ person, px, badge, badgeTone }) => {
    return (
      <span className={styles.root}>
        <Avatar person={person} px={px} />
        {badge != null ? (
          <span
            className={styles.badge}
            data-tone={badgeTone ? personTone(badgeTone) : undefined}
            data-testid="week-day-small-badge"
            aria-hidden
          >
            {badge}
          </span>
        ) : null}
      </span>
    )
  },
  'AvatarWithBadge',
)
