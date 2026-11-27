import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import type { WidgetChrome } from 'widget-sdk/ui/WidgetControls'

import { useCats } from '../cats-context'
import { AllCatsTab } from '../parts/AllCatsTab'
import { CatsHeader } from '../parts/CatsHeader'
import { ProfileTab } from '../parts/ProfileTab'
import { WeightTab } from '../parts/WeightTab'

import styles from './FullscreenTier.module.css'

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
      {tab === 'weight' && <WeightTab />}
      {tab === 'all' && <AllCatsTab />}
    </div>
  )
}, 'CatsFullscreenTier')
