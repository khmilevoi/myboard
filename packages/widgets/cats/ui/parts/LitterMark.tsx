import type { CatSummary } from 'module-cats'
import { CatAvatar, CatAvatarStack } from 'module-cats/ui/CatAvatar'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import styles from './LitterMark.module.css'

/** The avatar of a litter option: its cat, the stack of its cats, or "+" for a new litter. */
export const LitterMark = reatomMemo<{ cats: CatSummary[] }>(({ cats }) => {
  const [only] = cats
  if (cats.length === 0) {
    return (
      <span className={styles.newMark} aria-hidden>
        +
      </span>
    )
  }
  if (cats.length === 1 && only) {
    return <CatAvatar name={only.name} tone={only.tone} photoUrl={only.avatar} size="list" />
  }
  return <CatAvatarStack cats={cats} size="list" />
}, 'CatsLitterMark')
