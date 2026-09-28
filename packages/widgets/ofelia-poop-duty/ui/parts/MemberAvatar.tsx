import { Clock } from 'lucide-react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import { UserAvatar } from 'widget-sdk/ui/UserAvatar'

import type { EntryAuthor } from '@/domain/author'

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

    if (author.kind === 'system') {
      return (
        <span
          className={styles.avatar}
          data-kind="system"
          style={style}
          title="Закрыто автоматически"
          aria-hidden
        >
          <Clock size={Math.round(px * 0.6)} aria-hidden />
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

    // Every other branch here is `aria-hidden`: the circle is decoration, and
    // the paired text next to it carries the name. This one used to be the
    // exception — its initial (and, with an avatar image, the `alt` text)
    // got announced a second time right before the written name, e.g.
    // "Карина отметил(а) Карина" (F17).
    return (
      <UserAvatar
        className={styles.avatar}
        data-kind="account"
        data-viewer={isViewer}
        name={author.name}
        identityKey={author.accountId}
        avatarUrl={author.avatarUrl}
        px={px}
        shape="rounded"
        decorative
      />
    )
  },
  'MemberAvatar',
)
