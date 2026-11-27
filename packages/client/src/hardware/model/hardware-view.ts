import type { HardwareSnapshot } from '@shared/hardware/board-api'
import { HARDWARE_MODELS, type BleAddress } from '@shared/hardware/models'
import { SCALE_USER_SLOTS, type ScaleUserIndex } from '@shared/hardware/spike-assumptions'

import { formatAgo, formatBattery, formatLastReading } from './hardware-format'

export const LOW_BATTERY_PERCENT = 20

// A gateway that connected this recently shows «подключён …» instead of «на связи только что».
const RECENT_CONNECT_MS = 10 * 60_000

type SnapshotGateway = HardwareSnapshot['gateways'][number]
type SnapshotHardware = HardwareSnapshot['hardware'][number]

export type ProfileRow = { index: ScaleUserIndex; mine: boolean }
export type HardwareRow = {
  id: string
  title: string
  gatewayId: string | null
  gatewayOnline: boolean
  batteryLabel: string | null
  batteryLow: boolean
  lastReadingLabel: string
  profiles: ProfileRow[]
  hasMine: boolean
  freeSlots: number
}
export type GatewayRow = { id: string; label: string; online: boolean; statusLabel: string }
export type ReturnRow = { gatewayId: string; gatewayLabel: string; hardware: HardwareRow }
export type AdoptRow = {
  gatewayId: string
  gatewayLabel: string
  address: BleAddress
  title: string
}
export type HardwareWindow = {
  empty: boolean
  gateways: GatewayRow[]
  attached: HardwareRow[]
  detached: HardwareRow[]
  returnable: ReturnRow[]
  adoptable: AdoptRow[]
  primary: 'addGateway' | 'addHardware' | null
  addHardwareEnabled: boolean
  onlineGatewayId: string | null
}

function gatewayStatus(gateway: SnapshotGateway, now: number): string {
  if (!gateway.online) return `не в сети · был на связи ${formatAgo(gateway.lastSeenAt, now)}`
  const { connectedAt } = gateway
  if (connectedAt !== null && now - connectedAt < RECENT_CONNECT_MS) {
    return `в сети · подключён ${formatAgo(connectedAt, now)}`
  }
  return 'в сети · на связи только что'
}

function makeHardwareRow(
  hardware: SnapshotHardware,
  gatewayOnline: boolean,
  now: number,
): HardwareRow {
  const { battery } = hardware
  const profiles: ProfileRow[] = hardware.profiles
    .filter((profile) => profile.binding !== 'none')
    .map((profile) => ({ index: profile.index, mine: profile.binding === 'mine' }))
  return {
    id: hardware.id,
    title: HARDWARE_MODELS[hardware.model].label,
    gatewayId: hardware.gatewayId,
    gatewayOnline,
    batteryLabel: battery === null ? null : formatBattery(battery),
    batteryLow: battery !== null && battery < LOW_BATTERY_PERCENT,
    lastReadingLabel: formatLastReading(hardware.lastReadingAt, now),
    profiles,
    hasMine: profiles.some((profile) => profile.mine),
    freeSlots: Math.max(0, SCALE_USER_SLOTS - hardware.profiles.length),
  }
}

export function deriveHardwareWindow(snapshot: HardwareSnapshot, now: number): HardwareWindow {
  const { gateways, hardware } = snapshot
  const gatewayById = new Map(gateways.map((gateway) => [gateway.id, gateway]))

  const attached: HardwareRow[] = []
  const detached: HardwareRow[] = []
  const returnable: ReturnRow[] = []
  const matchedBonds = new Set<string>()
  const bondKey = (gatewayId: string, address: string, model: string) =>
    `${gatewayId}|${address}|${model}`

  for (const item of hardware) {
    const gateway = item.gatewayId === null ? undefined : gatewayById.get(item.gatewayId)
    if (gateway !== undefined) {
      attached.push(makeHardwareRow(item, gateway.online, now))
      continue
    }
    const bondedOn = gateways.find((candidate) =>
      candidate.bondedNotAdopted.some(
        (bond) => bond.address === item.address && bond.model === item.model,
      ),
    )
    if (bondedOn === undefined) {
      detached.push(makeHardwareRow(item, false, now))
      continue
    }
    matchedBonds.add(bondKey(bondedOn.id, item.address, item.model))
    returnable.push({
      gatewayId: bondedOn.id,
      gatewayLabel: bondedOn.label,
      hardware: makeHardwareRow(item, bondedOn.online, now),
    })
  }

  const adoptable: AdoptRow[] = gateways.flatMap((gateway) =>
    gateway.bondedNotAdopted
      .filter((bond) => !matchedBonds.has(bondKey(gateway.id, bond.address, bond.model)))
      .map((bond) => ({
        gatewayId: gateway.id,
        gatewayLabel: gateway.label,
        address: bond.address,
        title: HARDWARE_MODELS[bond.model].label,
      })),
  )

  const onlineGatewayId = gateways.find((gateway) => gateway.online)?.id ?? null
  const primary: HardwareWindow['primary'] =
    gateways.length === 0
      ? 'addGateway'
      : adoptable.length > 0 || returnable.length > 0
        ? null
        : 'addHardware'

  return {
    empty: gateways.length === 0 && hardware.length === 0,
    gateways: gateways.map((gateway) => ({
      id: gateway.id,
      label: gateway.label,
      online: gateway.online,
      statusLabel: gatewayStatus(gateway, now),
    })),
    attached,
    detached,
    returnable,
    adoptable,
    primary,
    addHardwareEnabled: onlineGatewayId !== null,
    onlineGatewayId,
  }
}
