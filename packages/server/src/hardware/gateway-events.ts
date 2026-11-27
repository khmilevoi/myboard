import type { GatewayEvent } from '@shared/hardware/gateway-protocol'

import type { HardwareDeps } from './http'
import type { GatewayRecord } from './records'
import { updateGateway } from './store'

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
      const updated = await updateGateway(deps.ops, gateway.id, (current) => ({
        ...current,
        bonded: event.hardware.map((item) => ({ address: item.address, model: item.model })),
      }))
      if (updated instanceof Error) return updated
      if (updated === null) return
      return deps.publish({ type: 'changed' })
    }
    // Accepted and ignored until their tasks fill them in.
    case 'scan.result':
    case 'scan.finished':
    case 'pairing.progress':
    case 'scaleUsers':
    case 'battery':
    case 'scaleUser.created':
    case 'scaleUser.attached':
    case 'scaleUser.updated':
    case 'command.failed':
      return
  }
}
