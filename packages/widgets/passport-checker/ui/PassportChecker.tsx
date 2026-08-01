import { useMemo } from 'react'
import { useWidgetContext } from 'widget-runtime'
import type { WidgetTier } from 'widget-runtime'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import { useWidgetChrome } from 'widget-sdk/ui/WidgetControls'

import { makePassportCheckModel } from '../model/check-model'
import { passportInstance } from '../model/instance-store'
import { loadNoVncRfb } from '../model/load-rfb'
import { makeRecoveryFlow } from '../model/recovery-flow'
import { makeRecoveryModel } from '../model/recovery-model'
import { makeRecoveryTransport } from '../model/recovery-transport'
import type { PassportCheckerEvents } from '../types'
import { passportCheckerContext } from './passport-checker-context'
import type { PassportCheckerContextValue } from './passport-checker-context'
import { RecoveryModal } from './RecoveryModal'
import { FullscreenTier } from './tiers/FullscreenTier'
import { StandardTier } from './tiers/StandardTier'
import { TinyTier } from './tiers/TinyTier'

import styles from './passport-checker.module.css'

/** `standard`/`large` share one layout; `fullscreen` is its own, distinct one. */
export function isStandardLayout(tier: WidgetTier): boolean {
  return tier === 'standard' || tier === 'large'
}

export const PassportChecker = reatomMemo(() => {
  const { tier, typeId, instanceId, api, storage } = useWidgetContext<PassportCheckerEvents>()

  const { checkModel, recoveryModel, recoveryFlow } = passportInstance(instanceId, () => {
    const checkModel = makePassportCheckModel({ api, storage: storage.shared.server })
    const recoveryModel = makeRecoveryModel({
      widgetId: typeId,
      transport: makeRecoveryTransport(),
      loadRfb: loadNoVncRfb,
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

  // Plain (unwrapped) on purpose: the tiers only re-render when their own
  // viewState() changes, independently of PassportChecker's own render. A
  // wrap() built here would bind to this component's render frame and go
  // stale the next time a tier re-renders without PassportChecker
  // re-rendering alongside it — the button would then silently do nothing.
  // Each tier wraps this in its own render instead (mirrors the `check`
  // handler each tier already builds for its own "Проверить" button).
  // fullscreen shows the live session inline, tiny/standard open it as a
  // portal modal — see `recoverySurface` in check-model.ts for why the two
  // can never both render it for the same instance.
  const openModalRecovery = () => recoveryFlow.openRecovery({ surface: 'modal' })
  const openInlineRecovery = () => recoveryFlow.openRecovery({ surface: 'inline' })

  // Only the board tile gets `onExpand`; fullscreen itself remains close-only
  // through useWidgetChrome. Tiny exposes it as the route to the full document
  // details, while Standard/Fullscreen already have the room to show those
  // details inline.
  const { onExpand, onDelete, onClose } = useWidgetChrome()

  return (
    <passportCheckerContext.Provider value={value}>
      <div className={styles.widget} data-tier={tier}>
        {tier === 'fullscreen' ? (
          <FullscreenTier onOpenRecovery={openInlineRecovery} onClose={onClose} />
        ) : isStandardLayout(tier) ? (
          <StandardTier onOpenRecovery={openModalRecovery} onDelete={onDelete} onClose={onClose} />
        ) : (
          <TinyTier
            onOpenRecovery={openModalRecovery}
            onExpand={onExpand}
            onDelete={onDelete}
            onClose={onClose}
          />
        )}
      </div>
      {/* Gated on `tier` too, not just the surface: the tile and the fullscreen
          mount of one instance can be alive at once and both read the same
          shared `recoverySurface`, so a bare surface check would render the
          modal from both the moment either one opens it. Only a non-fullscreen
          mount is ever the "tile" a modal surface is meant for. */}
      {tier !== 'fullscreen' && checkModel.recoverySurface() === 'modal' && <RecoveryModal />}
    </passportCheckerContext.Provider>
  )
}, 'PassportChecker')
