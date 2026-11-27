import { wrap } from '@reatom/core'
import { formatDaysAgo } from 'module-cats/format'
import { CatAvatar } from 'module-cats/ui/CatAvatar'
import { CatSwitcher } from 'module-cats/ui/CatSwitcher'
import { MemberAvatar } from 'module-cats/ui/MemberAvatar'
import { WeighDialog } from 'module-cats/ui/WeighDialog'
import { useState } from 'react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import { WidgetControls, type WidgetChrome } from 'widget-sdk/ui/WidgetControls'

import { useCats } from '../cats-context'
import { KgFigure, WeightSpark, WeightTrend } from '../parts/CatWeight'
import { dotLine } from '../parts/dot-line'
import { PassportActions } from '../parts/PassportActions'
import { PassportFacts } from '../parts/PassportFacts'

import styles from './StandardTier.module.css'

export type StandardTierProps = { chrome: WidgetChrome }

const STALE_NOTE = 'Не взвешивали две недели — цель по калориям считается по старому весу'

// Page 10, standard (321–560 px), states A–C: the passport and the quick actions. The switcher
// appears only with more than one cat (state A draws none); the controls end the header row.
export const StandardTier = reatomMemo<StandardTierProps>(({ chrome }) => {
  const { card, manage } = useCats()
  // Per mount, not per instance: the board tile and the fullscreen mount must not both open it.
  const [weighOpen, setWeighOpen] = useState(false)

  const current = card.choice.current()
  const options = card.choice.options()
  const passport = card.view.passport()
  if (current === null || options === null || passport === null) return null
  const weight = card.view.weight()
  const details = dotLine([passport.ageLong, passport.sexLabel, passport.sterilizedLabel])
  const hasFacts = passport.bodyCondition !== null || passport.goalToday !== null

  const onWeigh = wrap(() => setWeighOpen(true))

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <CatAvatar
          name={passport.name}
          tone={current.tone}
          photoUrl={current.avatar}
          size="profile"
        />
        <div className={styles.titles}>
          <h2 className={styles.name}>{passport.name}</h2>
          {passport.breed && <p className={styles.breed}>{passport.breed}</p>}
        </div>
        {card.choice.canSwitch() && (
          <CatSwitcher
            kind="cat"
            variant="menu"
            options={options.map((cat) => ({ id: cat.id, label: cat.name, cats: [cat] }))}
            currentId={current.id}
            onChoose={card.choice.choose}
            manage={manage}
          />
        )}
        <WidgetControls placement="inline" {...chrome} />
      </div>
      {details && <p className={styles.details}>{details}</p>}

      {weight && (
        <>
          <div className={styles.divider} />
          <div className={styles.weightHead}>
            <span className={styles.label}>Вес</span>
            {weight.daysAgo !== null && (
              <span className={styles.when}>
                {`взвешивали ${formatDaysAgo(weight.daysAgo)}`}
                {weight.author.kind !== 'unknown' && (
                  <>
                    {' · '}
                    <MemberAvatar author={weight.author} px={20} />
                  </>
                )}
              </span>
            )}
          </div>
          <p className={styles.weight}>
            <KgFigure kg={weight.kg} size="standard" />
            {weight.trend30 !== null && <WeightTrend grams={weight.trend30} suffix=" за месяц" />}
          </p>
          {weight.stale ? (
            <div className={styles.note}>
              <span className={styles.noteText}>{STALE_NOTE}</span>
              <button type="button" className={styles.noteLink} onClick={onWeigh}>
                Взвесить
              </button>
            </div>
          ) : (
            <WeightSpark labels className={styles.spark} />
          )}
        </>
      )}

      {hasFacts && (
        <>
          <div className={styles.divider} />
          <PassportFacts bodyCondition={passport.bodyCondition} goalToday={passport.goalToday} />
        </>
      )}

      <div className={styles.spacer} />
      <PassportActions onWeigh={onWeigh} />

      <WeighDialog
        form={card.weighForm}
        name={passport.name}
        open={weighOpen}
        onOpenChange={setWeighOpen}
      />
    </div>
  )
}, 'CatsStandardTier')
