import { randomUUID } from 'node:crypto'

import type { GatewayCommand } from '@shared/hardware/gateway-protocol'

import type { HardwareDeps } from './http'
import { getBindings, listHardware } from './store'

type SyncedBinding = Extract<GatewayCommand, { type: 'bindings.sync' }>['bindings'][number]

/**
 * Tells a gateway every binding of every hardware attached to it (`bindings.sync`), so it can
 * recognise readings of its scales. A no-op while the gateway is offline: it syncs on reconnect.
 */
export async function syncBindings(deps: HardwareDeps, gatewayId: string): Promise<void | Error> {
  if (!deps.connections.isOnline(gatewayId)) return
  const all = await listHardware(deps.ops)
  if (all instanceof Error) return all
  const bindings: SyncedBinding[] = []
  for (const hardware of all) {
    if (hardware.gatewayId !== gatewayId) continue
    const own = await getBindings(deps.ops, hardware.id)
    if (own instanceof Error) return own
    for (const binding of own) {
      bindings.push({
        hardwareId: hardware.id,
        address: hardware.address,
        model: hardware.model,
        index: binding.index,
        consentCode: binding.consentCode,
      })
    }
  }
  deps.connections.send(gatewayId, { id: randomUUID(), type: 'bindings.sync', bindings })
}
