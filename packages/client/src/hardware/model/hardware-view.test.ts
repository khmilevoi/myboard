import type { HardwareSnapshot } from '@shared/hardware/board-api'
import { SCALE_USER_SLOTS } from '@shared/hardware/spike-assumptions'
import { describe, expect, it } from 'vitest'

import { deriveHardwareWindow } from './hardware-view'

const NOW = Date.UTC(2026, 10, 27, 12, 0, 0)
const MIN = 60_000
const HOUR = 60 * MIN
const ADDRESS = 'AA:BB:CC:DD:EE:01'

type Gateway = HardwareSnapshot['gateways'][number]
type Hardware = HardwareSnapshot['hardware'][number]

function makeGateway(over: Partial<Gateway> = {}): Gateway {
  return {
    id: 'g1',
    label: 'Шлюз на кухне',
    online: true,
    lastSeenAt: NOW,
    connectedAt: null,
    adapterPowered: true,
    scan: null,
    bondedNotAdopted: [],
    ...over,
  }
}

function makeHardware(over: Partial<Hardware> = {}): Hardware {
  return {
    id: 'h1',
    gatewayId: 'g1',
    model: 'beurer-bf950',
    address: ADDRESS,
    battery: 80,
    lastReadingAt: null,
    profiles: [],
    ...over,
  }
}

function makeSnapshot(gateways: Gateway[] = [], hardware: Hardware[] = []): HardwareSnapshot {
  return { gateways, hardware }
}

describe('deriveHardwareWindow', () => {
  it('§2(a) nothing connected → empty, primary addGateway', () => {
    const view = deriveHardwareWindow(makeSnapshot(), NOW)
    expect(view.empty).toBe(true)
    expect(view.primary).toBe('addGateway')
    expect(view.addHardwareEnabled).toBe(false)
    expect(view.onlineGatewayId).toBeNull()
  })

  it('§2(b) online gateway and a scale with mine + other → attached row', () => {
    const view = deriveHardwareWindow(
      makeSnapshot(
        [makeGateway()],
        [
          makeHardware({
            profiles: [
              { index: 1, binding: 'mine' },
              { index: 2, binding: 'other' },
            ],
          }),
        ],
      ),
      NOW,
    )
    expect(view.empty).toBe(false)
    expect(view.attached).toHaveLength(1)
    const row = view.attached[0]!
    expect(row.title).toBe('Beurer BF 950')
    expect(row.gatewayOnline).toBe(true)
    expect(row.profiles).toEqual([
      { index: 1, mine: true },
      { index: 2, mine: false },
    ])
    expect(row.hasMine).toBe(true)
    expect(view.primary).toBe('addHardware')
    expect(view.addHardwareEnabled).toBe(true)
    expect(view.gateways[0]!.statusLabel).toBe('в сети · на связи только что')
  })

  it('§2(b2) battery 14 is low, 20 is not, null has no label', () => {
    const rowFor = (battery: number | null) =>
      deriveHardwareWindow(makeSnapshot([makeGateway()], [makeHardware({ battery })]), NOW)
        .attached[0]!
    expect(rowFor(14)).toMatchObject({ batteryLow: true, batteryLabel: 'батарея 14%' })
    expect(rowFor(20)).toMatchObject({ batteryLow: false, batteryLabel: 'батарея 20%' })
    expect(rowFor(null)).toMatchObject({ batteryLow: false, batteryLabel: null })
  })

  it('§2(c) only other profiles → hasMine false', () => {
    const view = deriveHardwareWindow(
      makeSnapshot([makeGateway()], [makeHardware({ profiles: [{ index: 3, binding: 'other' }] })]),
      NOW,
    )
    expect(view.attached[0]!.hasMine).toBe(false)
  })

  it('binding none is not listed, but still takes a slot', () => {
    const view = deriveHardwareWindow(
      makeSnapshot(
        [makeGateway()],
        [
          makeHardware({
            profiles: [
              { index: 1, binding: 'mine' },
              { index: 2, binding: 'none' },
              { index: 3, binding: 'other' },
            ],
          }),
        ],
      ),
      NOW,
    )
    const row = view.attached[0]!
    expect(row.profiles.map((p) => p.index)).toEqual([1, 3])
    expect(row.freeSlots).toBe(SCALE_USER_SLOTS - 3)
  })

  it('§2(d) offline gateway disables adding and marks rows offline', () => {
    const view = deriveHardwareWindow(
      makeSnapshot([makeGateway({ online: false, lastSeenAt: NOW - 3 * HOUR })], [makeHardware()]),
      NOW,
    )
    expect(view.addHardwareEnabled).toBe(false)
    expect(view.primary).toBe('addHardware')
    expect(view.attached[0]!.gatewayOnline).toBe(false)
    expect(view.gateways[0]).toMatchObject({
      online: false,
      statusLabel: 'не в сети · был на связи 3 ч назад',
    })
  })

  it('§2(e) bondedNotAdopted with no detached match → adoptable row, primary null', () => {
    const view = deriveHardwareWindow(
      makeSnapshot([
        makeGateway({ bondedNotAdopted: [{ address: ADDRESS, model: 'beurer-bf950' }] }),
      ]),
      NOW,
    )
    expect(view.adoptable).toEqual([
      { gatewayId: 'g1', gatewayLabel: 'Шлюз на кухне', address: ADDRESS, title: 'Beurer BF 950' },
    ])
    expect(view.returnable).toEqual([])
    expect(view.primary).toBeNull()
  })

  it('§2(e2) no gateways, detached hardware → detached row, primary addGateway', () => {
    const view = deriveHardwareWindow(makeSnapshot([], [makeHardware({ gatewayId: null })]), NOW)
    expect(view.empty).toBe(false)
    expect(view.detached).toHaveLength(1)
    expect(view.attached).toEqual([])
    expect(view.primary).toBe('addGateway')
  })

  it('§2(e3) detached hardware in a gateway bondedNotAdopted → returnable with its profiles', () => {
    const view = deriveHardwareWindow(
      makeSnapshot(
        [makeGateway({ bondedNotAdopted: [{ address: ADDRESS, model: 'beurer-bf950' }] })],
        [makeHardware({ gatewayId: null, profiles: [{ index: 1, binding: 'mine' }] })],
      ),
      NOW,
    )
    expect(view.detached).toEqual([])
    expect(view.adoptable).toEqual([])
    expect(view.returnable).toHaveLength(1)
    expect(view.returnable[0]).toMatchObject({ gatewayId: 'g1', gatewayLabel: 'Шлюз на кухне' })
    expect(view.returnable[0]!.hardware.profiles).toEqual([{ index: 1, mine: true }])
    expect(view.primary).toBeNull()
  })

  it('connectedAt 2 min ago → «в сети · подключён 2 мин назад»', () => {
    const view = deriveHardwareWindow(
      makeSnapshot([makeGateway({ connectedAt: NOW - 2 * MIN })]),
      NOW,
    )
    expect(view.gateways[0]!.statusLabel).toBe('в сети · подключён 2 мин назад')
  })

  it('two gateways, first offline → onlineGatewayId is the second', () => {
    const view = deriveHardwareWindow(
      makeSnapshot([makeGateway({ id: 'g1', online: false }), makeGateway({ id: 'g2' })]),
      NOW,
    )
    expect(view.onlineGatewayId).toBe('g2')
    expect(view.addHardwareEnabled).toBe(true)
  })

  it('rows show only battery and last reading time', () => {
    const view = deriveHardwareWindow(
      makeSnapshot([makeGateway()], [makeHardware({ lastReadingAt: null })]),
      NOW,
    )
    expect(view.attached[0]!.lastReadingLabel).toBe('взвешиваний ещё не было')
  })
})
