import { wrap } from '@reatom/core'
import { Plus } from 'lucide-react'
import { WeighDialog } from 'module-cats/ui/WeighDialog'
import { useState } from 'react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import type { WidgetChrome } from 'widget-sdk/ui/WidgetControls'

import { useCats } from '../cats-context'
import { CatsHeader } from '../parts/CatsHeader'
import { ProfileTab } from '../parts/ProfileTab'

import styles from './FullscreenTier.module.css'

// The "Вес" tab's own action until the weight history lands beside it.
const WeightPanel = reatomMemo(() => {
  const { card } = useCats()
  // Per mount: the board tile and the fullscreen mount must not both open the dialog.
  const [weighOpen, setWeighOpen] = useState(false)
  const passport = card.view.passport()
  if (passport === null) return null

  return (
    <section className={styles.panel} aria-label="Вес">
      <button type="button" className={styles.primary} onClick={wrap(() => setWeighOpen(true))}>
        <Plus aria-hidden />
        Взвесить
      </button>
      <WeighDialog
        form={card.weighForm}
        name={passport.name}
        open={weighOpen}
        onOpenChange={setWeighOpen}
      />
    </section>
  )
}, 'CatsWeightPanel')

export type FullscreenTierProps = { chrome: WidgetChrome }

/**
 * `CatsLarge`: the header with the tabs, then the chosen tab. The fullscreen mount and the board's
 * large tier both draw it; only the controls differ (`chrome`).
 */
export const FullscreenTier = reatomMemo<FullscreenTierProps>(({ chrome }) => {
  const { card } = useCats()
  const tab = card.tab()

  return (
    <div className={styles.root}>
      <CatsHeader chrome={chrome} />
      {tab === 'profile' && <ProfileTab />}
      {tab === 'weight' && <WeightPanel />}
      {tab === 'all' && <section className={styles.panel} aria-label="Все кошки" />}
    </div>
  )
}, 'CatsFullscreenTier')
