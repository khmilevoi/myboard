import type { HardwareSnapshot } from '@shared/hardware/board-api'

import { getJson } from '../auth/records'
import type { ValkeyOps } from '../storage/valkey'
import type { GatewayConnections } from './connections'
import { scanKey } from './keys'
import {
  type BindingRecord,
  type GatewayRecord,
  type HardwareRecord,
  ScanRecordSchema,
} from './records'
import { getBindings, listGateways, listHardware } from './store'

type SnapshotGateway = HardwareSnapshot['gateways'][number]
type SnapshotHardware = HardwareSnapshot['hardware'][number]

// Every field is mapped by hand: a spread would leak `tokenHash` or a consent code the day a
// record grows one.
async function gatewayView(
  ops: ValkeyOps,
  connections: GatewayConnections,
  gateway: GatewayRecord,
  hardware: HardwareRecord[],
): Promise<SnapshotGateway | Error> {
  const scan = await getJson(ops, scanKey(gateway.id), ScanRecordSchema)
  if (scan instanceof Error) return scan
  const adopted = new Set(
    hardware.filter((item) => item.gatewayId === gateway.id).map((item) => item.address),
  )
  return {
    id: gateway.id,
    label: gateway.label,
    online: connections.isOnline(gateway.id),
    lastSeenAt: gateway.lastSeenAt,
    connectedAt: gateway.connectedAt,
    adapterPowered: gateway.adapter === null ? null : gateway.adapter.powered,
    scan:
      scan === null
        ? null
        : {
            active: scan.active,
            startedAt: scan.startedAt,
            results: scan.results.map((result) => ({
              address: result.address,
              name: result.name,
              rssi: result.rssi,
              model: result.model,
            })),
          },
    bondedNotAdopted: gateway.bonded
      .filter((bond) => !adopted.has(bond.address))
      .map((bond) => ({ address: bond.address, model: bond.model })),
  }
}

function hardwareView(
  hardware: HardwareRecord,
  bindings: BindingRecord[],
  viewerAccountId: string,
): SnapshotHardware {
  const indexes = new Set([
    ...hardware.scaleUsers.map((user) => user.index),
    ...bindings.map((binding) => binding.index),
  ])
  return {
    id: hardware.id,
    gatewayId: hardware.gatewayId,
    model: hardware.model,
    address: hardware.address,
    battery: hardware.battery,
    lastReadingAt: hardware.lastReadingAt,
    profiles: [...indexes]
      .sort((a, b) => a - b)
      .map((index) => {
        const binding = bindings.find((candidate) => candidate.index === index)
        return {
          index,
          binding:
            binding === undefined
              ? 'none'
              : binding.accountId === viewerAccountId
                ? 'mine'
                : 'other',
        }
      }),
  }
}

export async function buildSnapshot(
  ops: ValkeyOps,
  connections: GatewayConnections,
  viewerAccountId: string,
): Promise<HardwareSnapshot | Error> {
  const gateways = await listGateways(ops)
  if (gateways instanceof Error) return gateways
  const hardware = await listHardware(ops)
  if (hardware instanceof Error) return hardware

  const gatewayViews: SnapshotGateway[] = []
  for (const gateway of gateways) {
    const view = await gatewayView(ops, connections, gateway, hardware)
    if (view instanceof Error) return view
    gatewayViews.push(view)
  }

  const hardwareViews: SnapshotHardware[] = []
  for (const item of hardware) {
    const bindings = await getBindings(ops, item.id)
    if (bindings instanceof Error) return bindings
    hardwareViews.push(hardwareView(item, bindings, viewerAccountId))
  }

  return { gateways: gatewayViews, hardware: hardwareViews }
}
