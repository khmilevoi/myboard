import { action, atom } from '@reatom/core'

import type { PassportCheckModel } from './check-model'
import type { RecoveryModel } from './recovery-model'

export type RecoveryFlowDeps = {
  checkModel: PassportCheckModel
  recoveryModel: RecoveryModel
}

export type OpenRecoveryOptions = { fromFullscreen: boolean; collapse: () => void }
export type FinishRecoveryOptions = { restore: () => void }

export type RecoveryFlow = ReturnType<typeof makeRecoveryFlow>

/**
 * Named transitions that span the two models. The check and recovery models
 * stay unaware of each other; this is the one place that composes them.
 *
 * The host callbacks arrive as arguments rather than as construction deps
 * because the two mounts of one widget do not have the same ones: only the
 * fullscreen mount has a working `requestClose`, and only the tile mount has a
 * working `requestFullscreen`. Each call therefore comes from the mount whose
 * callback is live — opening from a tier, finishing from the modal.
 */
export function makeRecoveryFlow({ checkModel, recoveryModel }: RecoveryFlowDeps) {
  const restorePending = atom(false, 'passportRecovery.restorePending')

  const openRecovery = action(({ fromFullscreen, collapse }: OpenRecoveryOptions) => {
    restorePending.set(fromFullscreen)
    checkModel.recoveryOpen.set(true)
    if (fromFullscreen) collapse()
  }, 'passportRecovery.open')

  const finish = (restore: () => void) => {
    recoveryModel.teardown()
    checkModel.recoveryOpen.set(false)
    if (!restorePending()) return
    restorePending.set(false)
    restore()
  }

  const closeRecovery = action(({ restore }: FinishRecoveryOptions) => {
    finish(restore)
  }, 'passportRecovery.close')

  const retryCheck = action(({ restore }: FinishRecoveryOptions) => {
    finish(restore)
    void checkModel.checkPassport()
  }, 'passportRecovery.retryCheck')

  return { openRecovery, closeRecovery, retryCheck }
}
