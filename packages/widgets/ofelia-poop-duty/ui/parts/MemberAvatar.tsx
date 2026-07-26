import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import type { EntryAuthor } from '@/domain/author'

import { memberInitial, memberTone } from '../member'
import { personInitial, personTone } from '../person'
import { AVATAR_INITIAL_RATIO } from './Avatar'

import styles from './MemberAvatar.module.css'

export type MemberAvatarProps = {
  author: EntryAuthor
  isViewer?: boolean
  px?: number
}

export const MemberAvatar = reatomMemo<MemberAvatarProps>(
  ({ author, isViewer = false, px = 18 }) => {
    const style = {
      inlineSize: `${px}px`,
      blockSize: `${px}px`,
      fontSize: `${px * AVATAR_INITIAL_RATIO}px`,
    }

    if (author.kind === 'unknown') {
      return (
        <span
          className={styles.avatar}
          data-kind="unknown"
          style={style}
          title="Автор неизвестен"
          aria-hidden
        >
          ?
        </span>
      )
    }

    // A record written before accounts existed carries only a duty signature, so
    // the duty circle stands in — deliberately the round shape, not the square.
    if (author.kind === 'person') {
      return (
        <span
          className={styles.avatar}
          data-kind="person"
          data-tone={personTone(author.person)}
          style={style}
          title={`${author.person} · без аккаунта`}
          aria-hidden
        >
          {personInitial(author.person)}
        </span>
      )
    }

    return (
      <span
        className={styles.avatar}
        data-kind="account"
        data-tone={memberTone(author.accountId)}
        data-viewer={isViewer}
        style={style}
        title={author.name}
      >
        {author.avatarUrl ? (
          <img className={styles.image} src={author.avatarUrl} alt={author.name} />
        ) : (
          memberInitial(author.name)
        )}
      </span>
    )
  },
  'MemberAvatar',
)
