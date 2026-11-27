import { describe, expect, it } from 'vitest'

import { HardwareSnapshotSchema, PinBodySchema } from './board-api'
import {
  GatewayCommandSchema,
  GatewayEventSchema,
  GatewayEventsBodySchema,
  GatewayReadingsBodySchema,
} from './gateway-protocol'
import { BleAddressSchema } from './models'
import { ConsentCodeSchema } from './spike-assumptions'

const address = 'AA:BB:CC:DD:EE:FF'
const profile = { heightCm: 180, birthDate: '1990-01-01', sex: 'male' as const }

const events = [
  { type: 'heartbeat', adapter: { powered: true } },
  { type: 'bonded', hardware: [{ address, model: 'beurer-bf950' }] },
  { type: 'scan.result', address, name: 'BF950', rssi: -60, model: 'beurer-bf950' },
  { type: 'scan.finished' },
  { type: 'pairing.progress', pairingId: 'p1', stage: 'pin_required' },
  { type: 'pairing.progress', pairingId: 'p1', stage: 'failed', reason: 'timeout' },
  { type: 'scaleUsers', hardwareId: 'h1', users: [{ index: 1 }] },
  { type: 'battery', hardwareId: 'h1', percent: 80 },
  { type: 'scaleUser.created', commandId: 'c1', index: 2 },
  { type: 'scaleUser.attached', commandId: 'c1' },
  { type: 'scaleUser.updated', hardwareId: 'h1', index: 2, revision: 3 },
  { type: 'command.failed', commandId: 'c1', reason: 'nope' },
]

describe('hardware wire schemas', () => {
  it('normalizes BLE addresses', () => {
    expect(BleAddressSchema.parse('aa:bb:cc:dd:ee:ff')).toBe(address)
    expect(BleAddressSchema.safeParse('AA-BB-CC-DD-EE-FF').success).toBe(false)
  })

  it('round-trips commands and rejects unknown ones', () => {
    const cmd = { id: 'c1', type: 'scan.start', durationMs: 30000 }
    expect(GatewayCommandSchema.parse(cmd)).toEqual(cmd)
    const create = {
      id: 'c2',
      type: 'scaleUser.create',
      hardwareId: 'h1',
      address,
      consentCode: '0042',
      profile,
    }
    expect(GatewayCommandSchema.parse(create)).toEqual(create)
    const sync = {
      id: 'c4',
      type: 'bindings.sync',
      hardware: [{ hardwareId: 'h1', address, model: 'beurer-bf950' }],
      bindings: [
        { hardwareId: 'h1', address, model: 'beurer-bf950', index: 1, consentCode: '0042' },
      ],
    }
    expect(GatewayCommandSchema.parse(sync)).toEqual(sync)
    // The hardware list is required: a gateway without it could not address an unbound scale.
    expect(
      GatewayCommandSchema.safeParse({ id: 'c5', type: 'bindings.sync', bindings: [] }).success,
    ).toBe(false)
    expect(GatewayCommandSchema.safeParse({ id: 'c3', type: 'nope' }).success).toBe(false)
  })

  it('round-trips every event type and rejects unknown ones', () => {
    for (const event of events) expect(GatewayEventSchema.parse(event)).toEqual(event)
    expect(GatewayEventSchema.safeParse({ type: 'nope' }).success).toBe(false)
    // Unknown models pass the wire schema; the server drops them.
    const newer = { type: 'bonded', hardware: [{ address, model: 'other' }] }
    expect(GatewayEventSchema.parse(newer)).toEqual(newer)
  })

  it('bounds batch sizes', () => {
    const hb = { type: 'heartbeat', adapter: { powered: true } }
    expect(GatewayEventsBodySchema.safeParse({ events: [] }).success).toBe(false)
    expect(GatewayEventsBodySchema.safeParse({ events: Array(50).fill(hb) }).success).toBe(true)
    expect(GatewayEventsBodySchema.safeParse({ events: Array(51).fill(hb) }).success).toBe(false)
    const reading = {
      ref: 'r',
      hardwareId: 'h1',
      scaleUserIndex: 1,
      takenAt: 1,
      metrics: { weight: { value: 70, unit: 'kg' } },
    }
    expect(
      GatewayReadingsBodySchema.safeParse({ readings: Array(100).fill(reading) }).success,
    ).toBe(true)
    expect(
      GatewayReadingsBodySchema.safeParse({ readings: Array(101).fill(reading) }).success,
    ).toBe(false)
    for (const scaleUserIndex of [0, 9])
      expect(
        GatewayReadingsBodySchema.safeParse({ readings: [{ ...reading, scaleUserIndex }] }).success,
      ).toBe(false)
  })

  it('validates PINs and consent codes', () => {
    expect(PinBodySchema.safeParse({ pin: '123456' }).success).toBe(true)
    expect(PinBodySchema.safeParse({ pin: '12345' }).success).toBe(false)
    expect(PinBodySchema.safeParse({ pin: '12a456' }).success).toBe(false)
    expect(ConsentCodeSchema.safeParse('0042').success).toBe(true)
    expect(ConsentCodeSchema.safeParse('42').success).toBe(false)
  })

  it('keeps the snapshot strict', () => {
    const hardware = {
      id: 'h1',
      gatewayId: null,
      model: 'beurer-bf950',
      address,
      battery: null,
      lastReadingAt: null,
      profiles: [{ index: 1, binding: 'mine' }],
    }
    expect(HardwareSnapshotSchema.safeParse({ gateways: [], hardware: [hardware] }).success).toBe(
      true,
    )
    expect(
      HardwareSnapshotSchema.safeParse({ gateways: [], hardware: [{ ...hardware, weight: 70 }] })
        .success,
    ).toBe(false)
  })
})
