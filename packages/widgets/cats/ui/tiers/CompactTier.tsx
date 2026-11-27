import { wrap } from '@reatom/core'
import { CatAvatar } from 'module-cats/ui/CatAvatar'
import { WeighDialog } from 'module-cats/ui/WeighDialog'
import { useState } from 'react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import { WidgetControls, type WidgetChrome } from 'widget-sdk/ui/WidgetControls'

import { useCats } from '../cats-context'
import { KgFigure, WeightSpark, WeightTrend } from '../parts/CatWeight'
import { dotLine } from '../parts/dot-line'
import { PassportActions } from '../parts/PassportActions'
import { PassportFacts } from '../parts/PassportFacts'

import styles from './CompactTier.module.css'

export type CompactTierProps = { chrome: WidgetChrome }

// Page 10, compact: breed and age, the weight with its monthly trend and the sparkline. No
// switcher, as in tiny; the top row holds no action, so the controls float over its corner.
// The drawn card is 268 × 200. A taller one — the single column of a 360 px phone, ~300 × 340 —
// fills with what the design system gives compact ("статус и быстрые действия"): the standard
// tier's details, facts and quick actions, each from the height it fits at
// (CompactTier.module.css). A cat never weighed shows the actions at any height: without them
// the card would be its header alone.
export const CompactTier = reatomMemo<CompactTierProps>(({ chrome }) => {
  const { card } = useCats()
  // Per mount, not per instance: the board tile and the fullscreen mount must not both open it.
  const [weighOpen, setWeighOpen] = useState(false)
  const current = card.choice.current()
  const passport = card.view.passport()
  if (current === null || passport === null) return null
  const weight = card.view.weight()
  const subline = dotLine([passport.breed, passport.ageShort])
  const details = dotLine([passport.sexLabel, passport.sterilizedLabel])
  const hasFacts = passport.bodyCondition !== null || passport.goalToday !== null

  return (
    <div className={styles.root} data-weighed={weight !== null}>
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
      {details && <p className={styles.details}>{details}</p>}
      {weight && (
        <div className={styles.status}>
          <p className={styles.weight}>
            <KgFigure kg={weight.kg} size="compact" />
            {weight.trend30 !== null && <WeightTrend grams={weight.trend30} suffix="/мес" />}
          </p>
          <WeightSpark labels={false} className={styles.spark} />
        </div>
      )}
      {hasFacts && (
        <PassportFacts
          bodyCondition={passport.bodyCondition}
          goalToday={passport.goalToday}
          className={styles.facts}
        />
      )}
      <PassportActions onWeigh={wrap(() => setWeighOpen(true))} className={styles.actions} />
      <WeighDialog
        form={card.weighForm}
        name={passport.name}
        open={weighOpen}
        onOpenChange={setWeighOpen}
      />
    </div>
  )
}, 'CatsCompactTier')
