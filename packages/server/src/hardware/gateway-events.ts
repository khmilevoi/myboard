import type { GatewayEvent } from '@shared/hardware/gateway-protocol'
import { HardwareModelSchema } from '@shared/hardware/models'

import type { HardwareDeps } from './http'
import { applyPairingProgress, finishScan, recordScanResult } from './lifecycle'
import { applyScaleUserUpdated, completeScaleUserCommand, failScaleUserCommand } from './profiles'
import type { GatewayRecord } from './records'
import { updateGateway, updateHardware } from './store'

/**
 * Applies one gateway event. Handlers are idempotent: the gateway resends a whole batch after any
 * failure. A `null` from a locked update means the gateway was revoked meanwhile: nothing is written.
 */
export async function handleGatewayEvent(
  deps: HardwareDeps,
  gateway: GatewayRecord,
  event: GatewayEvent,
): Promise<void | Error> {
  switch (event.type) {
    case 'heartbeat': {
      let changed = false
      const updated = await updateGateway(deps.ops, gateway.id, (current) => {
        changed = current.adapter?.powered !== event.adapter.powered
        return { ...current, adapter: { powered: event.adapter.powered } }
      })
      if (updated instanceof Error) return updated
      // The snapshot shows adapterPowered, so a flip is worth a board refresh; a repeat is not.
      if (updated === null || !changed) return
      // A publish failure is returned: the route answers 500 and the gateway resends the batch.
      return deps.publish({ type: 'changed' })
    }
    case 'bonded': {
      // A model this server does not know is not hardware the board can adopt.
      const bonded = event.hardware.flatMap((item) => {
        const model = HardwareModelSchema.safeParse(item.model)
        return model.success ? [{ address: item.address, model: model.data }] : []
      })
      const updated = await updateGateway(deps.ops, gateway.id, (current) => ({
        ...current,
        bonded,
      }))
      if (updated instanceof Error) return updated
      if (updated === null) return
      return deps.publish({ type: 'changed' })
    }
    case 'scan.result': {
      // A model this server does not know is not hardware the board can pair.
      const model = HardwareModelSchema.safeParse(event.model)
      if (!model.success) return
      return recordScanResult(deps, gateway.id, {
        address: event.address,
        name: event.name,
        rssi: event.rssi,
        model: model.data,
      })
    }
    case 'scan.finished':
      return finishScan(deps, gateway.id)
    case 'pairing.progress':
      return applyPairingProgress(deps, gateway.id, {
        pairingId: event.pairingId,
        stage: event.stage,
        ...(event.reason === undefined ? {} : { reason: event.reason }),
      })
    case 'scaleUsers':
    case 'battery': {
      // Only the owning gateway may report on a scale.
      let owned = false
      const updated = await updateHardware(deps.ops, event.hardwareId, (current) => {
        owned = current.gatewayId === gateway.id
        if (!owned) return current
        return event.type === 'battery'
          ? { ...current, battery: event.percent }
          : { ...current, scaleUsers: event.users }
      })
      if (updated instanceof Error) return updated
      if (updated === null || !owned) return
      return deps.publish({ type: 'changed' })
    }
    case 'scaleUser.created':
      return completeScaleUserCommand(
        deps,
        gateway.id,
        event.commandId,
        'scaleUser.create',
        event.index,
      )
    case 'scaleUser.attached':
      return completeScaleUserCommand(deps, gateway.id, event.commandId, 'scaleUser.attach', null)
    case 'command.failed':
      return failScaleUserCommand(deps, gateway.id, event.commandId, event.reason)
    case 'scaleUser.updated':
      return applyScaleUserUpdated(deps, gateway.id, event)
  }
}
