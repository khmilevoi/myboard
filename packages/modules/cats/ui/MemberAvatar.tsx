import { Clock } from 'lucide-react'
import { memberInitial, memberTone } from 'widget-sdk/lib/member-tone'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import type { EntryAuthor } from '../domain/author'
import { personInitial, personTone } from './person'

import styles from './MemberAvatar.module.css'

/**
 * Initial size as a fraction of the avatar box, shared with the duty widget's `Avatar`. A duty
 * circle and an account square are rendered side by side at the same `px` in the history phrase,
 * so a ratio that differs between them reads as two mismatched type sizes on one line.
 */
export const AVATAR_INITIAL_RATIO = 0.4

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
      <span
        className={styles.avatar}
        data-kind="account"
        data-tone={memberTone(author.accountId)}
        data-viewer={isViewer}
        style={style}
        title={author.name}
        aria-hidden
      >
        {author.avatarUrl ? (
          <img className={styles.image} src={author.avatarUrl} alt="" />
        ) : (
          memberInitial(author.name)
        )}
      </span>
    )
  },
  'MemberAvatar',
)
