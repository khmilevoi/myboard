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
  const { tier, typeId, instanceId, api, storage, requestClose, requestFullscreen } =
    useWidgetContext<PassportCheckerEvents>()

  const { checkModel, recoveryModel, recoveryFlow } = passportInstance(instanceId, () => {
    const checkModel = makePassportCheckModel({ api, storage: storage.shared.server })
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

  // Plain (unwrapped) on purpose: StandardTier/TinyTier only re-render when
  // their own viewState() changes, independently of PassportChecker's own
  // render. A wrap() built here would bind to this component's render frame
  // and go stale the next time a tier re-renders without PassportChecker
  // re-rendering alongside it — the button would then silently do nothing.
  // Each tier wraps this in its own render instead (mirrors the `check`
  // handler each tier already builds for its own "Проверить" button).
  const openRecovery = () =>
    recoveryFlow.openRecovery({ fromFullscreen: tier === 'fullscreen', collapse: requestClose })

  return (
    <passportCheckerContext.Provider value={value}>
      <div className={styles.widget} data-tier={tier}>
        {isStandardLayout(tier) ? (
          <StandardTier onOpenRecovery={openRecovery} />
        ) : (
          <TinyTier onOpenRecovery={openRecovery} />
        )}
      </div>
      {/* The fullscreen mount never owns the modal: opening recovery from it
          collapses fullscreen via requestClose, so only the tile mount is ever
          left rendering this modal, and closing/retrying restores fullscreen
          via requestFullscreen. */}
      {tier !== 'fullscreen' && checkModel.recoveryOpen() && (
        <RecoveryModal restoreFullscreen={requestFullscreen} />
      )}
    </passportCheckerContext.Provider>
  )
}, 'PassportChecker')
