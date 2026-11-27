import { CatAvatar } from 'module-cats/ui/CatAvatar'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import { WidgetControls, type WidgetChrome } from 'widget-sdk/ui/WidgetControls'

import { useCats } from '../cats-context'
import { KgFigure, WeightSpark, WeightTrend } from '../parts/CatWeight'
import { dotLine } from '../parts/dot-line'

import styles from './CompactTier.module.css'

export type CompactTierProps = { chrome: WidgetChrome }

// Page 10, compact: breed and age, the weight with its monthly trend and the sparkline. No
// switcher, as in tiny; the top row holds no action, so the controls float over its corner.
export const CompactTier = reatomMemo<CompactTierProps>(({ chrome }) => {
  const { card } = useCats()
  const current = card.choice.current()
  const passport = card.view.passport()
  if (current === null || passport === null) return null
  const weight = card.view.weight()
  const subline = dotLine([passport.breed, passport.ageShort])

  return (
    <div className={styles.root}>
      <WidgetControls placement="overlay" {...chrome} />
      <div className={styles.top}>
        <span className={styles.avatar}>
          <CatAvatar
            name={passport.name}
            tone={current.tone}
            photoUrl={current.avatar}
            size="header"
          />
        </span>
        <div className={styles.titles}>
          <h2 className={styles.name}>{passport.name}</h2>
          {subline && <p className={styles.sub}>{subline}</p>}
        </div>
      </div>
      {weight && (
        <div>
          <p className={styles.weight}>
            <KgFigure kg={weight.kg} size="compact" />
            {weight.trend30 !== null && <WeightTrend grams={weight.trend30} suffix="/мес" />}
          </p>
          <WeightSpark labels={false} className={styles.spark} />
        </div>
      )}
    </div>
  )
}, 'CatsCompactTier')
