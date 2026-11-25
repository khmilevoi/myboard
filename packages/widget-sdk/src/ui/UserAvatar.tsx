import { useState, type HTMLAttributes } from 'react'

import { reatomMemo } from '../reatom/reatom-memo'

import styles from './UserAvatar.module.css'

export const AVATAR_TONES = ['1', '2', '3', '4', '5', '6'] as const
export type AvatarTone = (typeof AVATAR_TONES)[number]

/** Stable across display-name changes when given the account key. Never renders the key. */
export function getAvatarTone(identityKey: string): AvatarTone {
  let hash = 0
  for (let index = 0; index < identityKey.length; index++) {
    hash = (hash * 31 + identityKey.charCodeAt(index)) >>> 0
  }
  return AVATAR_TONES[hash % AVATAR_TONES.length]
}

export function getAvatarInitials(name: string | null | undefined): string {
  const words = name?.normalize('NFC').trim().split(/\s+/).filter(Boolean) ?? []
  if (!words.length) return '?'
  const initial = (word: string) => Array.from(word)[0].toUpperCase()
  return initial(words[0]) + (words.length > 1 ? initial(words[words.length - 1]) : '')
}

export type UserAvatarProps = Omit<HTMLAttributes<HTMLSpanElement>, 'children'> & {
  name?: string | null
  avatarUrl?: string | null
  identityKey?: string
  px?: number
  shape?: 'circle' | 'rounded'
  /** Use beside a visible name to avoid announcing the same person twice. */
  decorative?: boolean
  label?: string
}

// Image failure is local DOM state. The caller keys this boundary by identity
// and URL, so a failed picture never hides a later person's replacement image.
const AvatarImage = reatomMemo<{ src: string; fallback: string }>(({ src, fallback }) => {
  const [failed, setFailed] = useState(false)
  return failed ? (
    fallback
  ) : (
    <img
      className={styles.image}
      src={src}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  )
}, 'UserAvatar.Image')

/** Presentational identity only: the widget supplies its viewer or resolved author. */
export const UserAvatar = reatomMemo<UserAvatarProps>(
  ({
    name,
    avatarUrl,
    identityKey,
    px = 28,
    shape = 'circle',
    decorative = false,
    label,
    className,
    style,
    ...attributes
  }) => {
    const displayName = name?.trim() ?? ''
    const initials = getAvatarInitials(displayName)
    const src = avatarUrl?.trim()
    const accessibleName = label ?? (displayName || 'Неизвестный пользователь')
    return (
      <span
        {...attributes}
        className={[styles.avatar, className].filter(Boolean).join(' ')}
        data-tone={getAvatarTone(identityKey ?? displayName)}
        data-shape={shape}
        data-unknown={!displayName || undefined}
        role={decorative ? undefined : 'img'}
        aria-hidden={decorative || undefined}
        aria-label={decorative ? undefined : accessibleName}
        title={accessibleName}
        style={{
          inlineSize: `${px}px`,
          blockSize: `${px}px`,
          fontSize: `${px * (initials.length > 1 ? 0.36 : 0.4)}px`,
          ...style,
        }}
      >
        {src ? (
          <AvatarImage
            key={JSON.stringify([identityKey, displayName, src])}
            src={src}
            fallback={initials}
          />
        ) : (
          initials
        )}
      </span>
    )
  },
  'UserAvatar',
)
