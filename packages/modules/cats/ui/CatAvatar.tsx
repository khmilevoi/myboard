import { cn } from 'widget-sdk/lib/utils'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import type { CatTone } from '../domain/cat'
import type { CatSummary } from '../model/cats-model'

import styles from './CatAvatar.module.css'
import ears from 'widget-sdk/ui/cat-ears.module.css'

/** 18 / 20 / 22 / 24 / 26 / 40 / 56 px, design `01 Дизайн-система` section 06а and `CatsLarge`'s list. */
export type CatAvatarSize = 'badge' | 'list' | 'menu' | 'button' | 'header' | 'row' | 'profile'

export type CatAvatarProps = {
  name: string
  tone: CatTone
  photoUrl: string | null
  size: CatAvatarSize
}

function catInitial(name: string): string {
  const trimmed = name.trim()
  return trimmed.length === 0 ? '?' : trimmed.slice(0, 1).toUpperCase()
}

/**
 * A cat's eared square: the photo when one is set, else the first letter on the cat's tone.
 * Always `aria-hidden`: the caller writes the name next to it, or labels its own control.
 */
export const CatAvatar = reatomMemo<CatAvatarProps>(({ name, tone, photoUrl, size }) => {
  return (
    <span className={cn(ears.catEars, styles.avatar)} data-tone={tone} data-size={size} aria-hidden>
      {photoUrl === null ? (
        catInitial(name)
      ) : (
        <img className={styles.image} src={photoUrl} alt="" />
      )}
    </span>
  )
}, 'CatAvatar')

export type CatAvatarStackProps = {
  cats: CatSummary[]
  size: CatAvatarSize
}

/** The cats sharing a litter, overlapped, each ringed in the card surface. */
export const CatAvatarStack = reatomMemo<CatAvatarStackProps>(({ cats, size }) => {
  return (
    <span className={styles.stack} aria-hidden>
      {cats.map((cat) => (
        <span key={cat.id} className={styles.ring}>
          <CatAvatar name={cat.name} tone={cat.tone} photoUrl={cat.avatar} size={size} />
        </span>
      ))}
    </span>
  )
}, 'CatAvatarStack')
