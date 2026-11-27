import { CatAvatar } from 'module-cats/ui/CatAvatar'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import { WidgetControls, type WidgetChrome } from 'widget-sdk/ui/WidgetControls'

import { useCats } from '../cats-context'
import { KgFigure } from '../parts/CatWeight'

import styles from './TinyTier.module.css'

export type TinyTierProps = { chrome: WidgetChrome }

// Page 10, tiny: who and how much she weighs. No switcher: the avatar says which cat this is, and
// the choice is changed from a larger tier.
export const TinyTier = reatomMemo<TinyTierProps>(({ chrome }) => {
  const { card } = useCats()
  const current = card.choice.current()
  const passport = card.view.passport()
  if (current === null || passport === null) return null
  const weight = card.view.weight()

  return (
    <div className={styles.root}>
      <WidgetControls placement="overlay" {...chrome} />
      <span className={styles.avatar}>
        <CatAvatar
          name={passport.name}
          tone={current.tone}
          photoUrl={current.avatar}
          size="header"
        />
      </span>
      <h2 className={styles.name}>{passport.name}</h2>
      {weight && <KgFigure kg={weight.kg} size="tiny" testId="cats-weight" />}
    </div>
  )
}, 'CatsTinyTier')
