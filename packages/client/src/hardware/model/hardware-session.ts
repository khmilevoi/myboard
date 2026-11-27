import { type HardwareBoardClient, makeHardwareBoardClient } from '@shared/hardware/board-client'
import { makeEventSourceStream } from '@shared/http/event-stream'
import { healthModule } from 'module-health'

import { activeBoard } from '@/board/model/board-storage'
import { hostRuntime, http } from '@/runtime'

import { makeAddGatewayModel, type AddGatewayModel } from './add-gateway-model'
import { type HardwareModel, makeHardwareModel } from './hardware-model'
import { makeWizardModel, type WizardModel } from './wizard-model'

/** The widget's directory basename (Decision 11). */
export const WEIGHT_WIDGET_TYPE_ID = 'weight'

export type HardwareSession = {
  model: HardwareModel
  addGateway: AddGatewayModel
  wizard: WizardModel
}

/** The add-gateway and wizard models over an existing hardware model; built once per dialog. */
export function makeHardwareSubModels(
  model: HardwareModel,
  client: HardwareBoardClient,
): Omit<HardwareSession, 'model'> {
  return {
    addGateway: makeAddGatewayModel({ hardware: model, client }),
    wizard: makeWizardModel({
      hardware: model,
      client,
      health: () => hostRuntime.makeWidgetModules([healthModule.id]).get(healthModule),
      hasWeightCard: () =>
        activeBoard()?.instances.some((i) => i.typeId === WEIGHT_WIDGET_TYPE_ID) ?? false,
    }),
  }
}

/**
 * The dialog's three models, built together exactly once per mounted dialog: the wizard hooks
 * `hardware.received` for good and cannot be rebuilt per open or per render.
 */
export function makeHardwareSession(): HardwareSession {
  const client = makeHardwareBoardClient(http)
  const model = makeHardwareModel({ client, openEventStream: makeEventSourceStream() })
  return { model, ...makeHardwareSubModels(model, client) }
}
