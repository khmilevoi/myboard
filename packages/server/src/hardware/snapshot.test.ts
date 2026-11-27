import { HardwareSnapshotSchema } from '@shared/hardware/board-api'
import { describe, expect, it } from 'vitest'

import { setJson } from '../auth/records'
import { createMemoryOps, createMemoryPubSub } from '../test/memory-ops'
import { makeGatewayConnections } from './connections'
import { scanKey } from './keys'
import type { BindingRecord, GatewayRecord, HardwareRecord } from './records'
import { buildSnapshot } from './snapshot'
import { putGateway, putHardware, updateBindings } from './store'

const TOKEN_HASH = 'f'.repeat(64)
const CONSENT_A = '4821'
const CONSENT_B = '7390'

const gateway: GatewayRecord = {
  id: 'g1',
  label: 'Hall gateway',
  tokenHash: TOKEN_HASH,
  createdAt: 1,
  createdBy: 'acc-a',
  lastSeenAt: 50,
  connectedAt: 40,
  adapter: { powered: true },
  bonded: [
    { address: 'AA:AA:AA:AA:AA:01', model: 'beurer-bf950' },
    { address: 'AA:AA:AA:AA:AA:02', model: 'beurer-bf950' },
  ],
}

const scale: HardwareRecord = {
  id: 'h1',
  gatewayId: 'g1',
  address: 'AA:AA:AA:AA:AA:01',
  model: 'beurer-bf950',
  createdAt: 2,
  battery: 80,
  lastReadingAt: 99,
  scaleUsers: [{ index: 3 }, { index: 1 }],
}

const detached: HardwareRecord = {
  id: 'h2',
  gatewayId: null,
  address: 'AA:AA:AA:AA:AA:09',
  model: 'beurer-bf950',
  createdAt: 3,
  battery: null,
  lastReadingAt: null,
  scaleUsers: [],
}

const binding = (index: number, accountId: string, consentCode: string): BindingRecord => ({
  hardwareId: 'h1',
  index,
  accountId,
  consentCode,
  createdAt: 4,
  profileRevision: 1,
  appliedRevision: 1,
})

async function seed() {
  const ops = createMemoryOps(createMemoryPubSub())
  await putGateway(ops, gateway)
  await putHardware(ops, scale)
  await putHardware(ops, detached)
  await updateBindings(ops, 'h1', () => [
    binding(2, 'acc-b', CONSENT_B),
    binding(1, 'acc-a', CONSENT_A),
  ])
  return ops
}

async function snapshotFor(viewer: string) {
  const ops = await seed()
  const snapshot = await buildSnapshot(ops, makeGatewayConnections(), viewer)
  if (snapshot instanceof Error) throw snapshot
  return snapshot
}

describe('buildSnapshot', () => {
  it('marks bindings mine/other per viewer and unbound scale users none', async () => {
    const forA = await snapshotFor('acc-a')
    expect(forA.hardware.find((h) => h.id === 'h1')?.profiles).toEqual([
      { index: 1, binding: 'mine' },
      { index: 2, binding: 'other' },
      { index: 3, binding: 'none' },
    ])
    const forB = await snapshotFor('acc-b')
    expect(forB.hardware.find((h) => h.id === 'h1')?.profiles).toEqual([
      { index: 1, binding: 'other' },
      { index: 2, binding: 'mine' },
      { index: 3, binding: 'none' },
    ])
  })

  it('maps gateways explicitly, with bonded hardware that is not adopted', async () => {
    const snapshot = await snapshotFor('acc-a')
    expect(HardwareSnapshotSchema.parse(snapshot)).toEqual(snapshot)
    expect(snapshot.gateways).toEqual([
      {
        id: 'g1',
        label: 'Hall gateway',
        online: false,
        lastSeenAt: 50,
        connectedAt: 40,
        adapterPowered: true,
        scan: null,
        bondedNotAdopted: [{ address: 'AA:AA:AA:AA:AA:02', model: 'beurer-bf950' }],
      },
    ])
  })

  it('carries the scan only while its record exists', async () => {
    const ops = await seed()
    const result = { address: 'AA:AA:AA:AA:AA:07', name: 'BF950', rssi: -60, model: 'beurer-bf950' }
    await setJson(ops, scanKey('g1'), {
      gatewayId: 'g1',
      startedAt: 70,
      active: true,
      results: [result],
    })
    const snapshot = await buildSnapshot(ops, makeGatewayConnections(), 'acc-a')
    if (snapshot instanceof Error) throw snapshot
    expect(snapshot.gateways[0]?.scan).toEqual({ active: true, startedAt: 70, results: [result] })
  })

  it('lists detached hardware with a null gatewayId', async () => {
    const snapshot = await snapshotFor('acc-a')
    expect(snapshot.hardware.find((h) => h.id === 'h2')).toEqual({
      id: 'h2',
      gatewayId: null,
      model: 'beurer-bf950',
      address: 'AA:AA:AA:AA:AA:09',
      battery: null,
      lastReadingAt: null,
      profiles: [],
    })
  })

  it('never carries the token hash or a consent code', async () => {
    const serialized = JSON.stringify(await snapshotFor('acc-a'))
    expect(serialized).not.toContain(TOKEN_HASH)
    expect(serialized).not.toContain(CONSENT_A)
    expect(serialized).not.toContain(CONSENT_B)
    expect(serialized).not.toContain('consentCode')
    expect(serialized).not.toContain('tokenHash')
  })
})
