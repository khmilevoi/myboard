import { useMemo } from 'react'
import { useWidgetContext } from 'widget-runtime'
import type { WidgetTier } from 'widget-runtime'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import { makePassportCheckModel } from '../model/check-model'
import type { PassportCheckerEvents } from '../types'
import { passportCheckerContext } from './passport-checker-context'
import type { PassportCheckerContextValue } from './passport-checker-context'
import { StandardTier } from './tiers/StandardTier'
import { TinyTier } from './tiers/TinyTier'

import styles from './passport-checker.module.css'

/** The widget has exactly two layouts; the five runtime tier names collapse. */
export function isStandardLayout(tier: WidgetTier): boolean {
  return tier === 'standard' || tier === 'large' || tier === 'fullscreen'
}

export const PassportChecker = reatomMemo(() => {
  const { tier, api } = useWidgetContext<PassportCheckerEvents>()
  const checkModel = useMemo(() => makePassportCheckModel({ api }), [api])
  const value = useMemo<PassportCheckerContextValue>(() => ({ checkModel }), [checkModel])

  return (
    <passportCheckerContext.Provider value={value}>
      <div className={styles.widget} data-tier={tier}>
        {isStandardLayout(tier) ? <StandardTier /> : <TinyTier />}
      </div>
    </passportCheckerContext.Provider>
  )
}, 'PassportChecker')
