import { action } from '@reatom/core'

import type { PassportCheckModel } from './check-model'
import type { RecoveryModel } from './recovery-model'

export type RecoveryFlowDeps = {
  checkModel: PassportCheckModel
  recoveryModel: RecoveryModel
}

export type RecoveryFlow = ReturnType<typeof makeRecoveryFlow>

/**
 * Named transitions that span the two models. The check and recovery models
 * stay unaware of each other; this is the one place that composes them.
 */
export function makeRecoveryFlow({ checkModel, recoveryModel }: RecoveryFlowDeps) {
  const closeRecovery = action(() => {
    recoveryModel.teardown()
    checkModel.recoveryOpen.set(false)
  }, 'passportRecovery.close')

  const retryCheck = action(() => {
    recoveryModel.teardown()
    checkModel.recoveryOpen.set(false)
    void checkModel.checkPassport()
  }, 'passportRecovery.retryCheck')

  return { closeRecovery, retryCheck }
}
