import { useMemo } from 'react'
import { useWidgetContext } from 'widget-runtime'
import type { WidgetTier } from 'widget-runtime'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import { makePassportCheckModel } from '../model/check-model'
import { passportInstance } from '../model/instance-store'
import { makeRecoveryFlow } from '../model/recovery-flow'
import { makeRecoveryModel } from '../model/recovery-model'
import { makeRecoveryTransport } from '../model/recovery-transport'
import { makeNoVncRfb } from '../model/rfb'
import type { PassportCheckerEvents } from '../types'
import { passportCheckerContext } from './passport-checker-context'
import type { PassportCheckerContextValue } from './passport-checker-context'
import { RecoveryModal } from './RecoveryModal'
import { StandardTier } from './tiers/StandardTier'
import { TinyTier } from './tiers/TinyTier'

import styles from './passport-checker.module.css'

/** The widget has exactly two layouts; the five runtime tier names collapse. */
export function isStandardLayout(tier: WidgetTier): boolean {
  return tier === 'standard' || tier === 'large' || tier === 'fullscreen'
}

export const PassportChecker = reatomMemo(() => {
  const { tier, typeId, instanceId, api } = useWidgetContext<PassportCheckerEvents>()

  const { checkModel, recoveryModel, recoveryFlow } = passportInstance(instanceId, () => {
    const checkModel = makePassportCheckModel({ api })
    const recoveryModel = makeRecoveryModel({
      widgetId: typeId,
      transport: makeRecoveryTransport(),
      makeRfb: makeNoVncRfb,
    })
    return {
      checkModel,
      recoveryModel,
      recoveryFlow: makeRecoveryFlow({ checkModel, recoveryModel }),
    }
  })()

  const value = useMemo<PassportCheckerContextValue>(
    () => ({ checkModel, recoveryModel, recoveryFlow }),
    [checkModel, recoveryModel, recoveryFlow],
  )

  return (
    <passportCheckerContext.Provider value={value}>
      <div className={styles.widget} data-tier={tier}>
        {isStandardLayout(tier) ? <StandardTier /> : <TinyTier />}
      </div>
      {/* The fullscreen mount never owns the modal: recovery collapses
          fullscreen, and with shared state both mounts would otherwise render
          one modal each. */}
      {tier !== 'fullscreen' && checkModel.recoveryOpen() && <RecoveryModal />}
    </passportCheckerContext.Provider>
  )
}, 'PassportChecker')
