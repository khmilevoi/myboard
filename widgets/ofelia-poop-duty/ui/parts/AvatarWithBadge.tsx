import type { Person } from '../../model/ofelia-duty'
import type { ReactNode } from 'react'

import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import { personTone } from '../person'
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
