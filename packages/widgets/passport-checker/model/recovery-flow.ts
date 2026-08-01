import { action } from '@reatom/core'

import type { PassportCheckModel, RecoverySurface } from './check-model'
import type { RecoveryModel } from './recovery-model'

export type RecoveryFlowDeps = {
  checkModel: PassportCheckModel
  recoveryModel: RecoveryModel
}

export type OpenRecoveryOptions = { surface: RecoverySurface }

export type RecoveryFlow = ReturnType<typeof makeRecoveryFlow>

/**
 * Named transitions that span the two models. The check and recovery models
 * stay unaware of each other; this is the one place that composes them.
 *
 * `surface` records which mount is allowed to render the live session (see
 * `recoverySurface` in check-model.ts) — tiny/standard always open the modal,
 * fullscreen always opens inline. Neither surface needs to collapse or
 * restore another mount: the modal is a portal the tile owns regardless of
 * whether a fullscreen mount also exists, and fullscreen shows recovery in
 * place without ever closing itself.
 */
export function makeRecoveryFlow({ checkModel, recoveryModel }: RecoveryFlowDeps) {
  const openRecovery = action(({ surface }: OpenRecoveryOptions) => {
    checkModel.recoverySurface.set(surface)
    checkModel.recoveryOpen.set(true)
  }, 'passportRecovery.open')

  const finish = () => {
    recoveryModel.teardown()
    checkModel.recoveryOpen.set(false)
    checkModel.recoverySurface.set(null)
  }

  const closeRecovery = action(() => {
    finish()
  }, 'passportRecovery.close')

  const retryCheck = action(() => {
    finish()
    void checkModel.checkPassport()
  }, 'passportRecovery.retryCheck')

  return { openRecovery, closeRecovery, retryCheck }
}
