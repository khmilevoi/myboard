import { makeWidgetInstanceStore } from 'widget-sdk'

import type { PassportCheckModel } from './check-model'
import type { RecoveryFlow } from './recovery-flow'
import type { RecoveryModel } from './recovery-model'

export type PassportInstanceModels = {
  checkModel: PassportCheckModel
  recoveryModel: RecoveryModel
  recoveryFlow: RecoveryFlow
}

/**
 * One model graph per placed passport widget, read by both the board tile and
 * the fullscreen overlay. Disposal tears the recovery session down as a safety
 * net in case the modal outlived the widget; in the normal flow the recovery
 * canvas effect has already done it.
 */
export const passportInstance = makeWidgetInstanceStore<PassportInstanceModels>({
  name: 'passport.instance',
  dispose: (models) => models.recoveryModel.teardown(),
})
