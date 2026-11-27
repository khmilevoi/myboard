import { describe, expect, it } from 'vitest'

import { createMemoryOps, createMemoryPubSub } from '../test/memory-ops'
import { bindingsKey, GATEWAY_IDS_KEY, gatewayKey, HARDWARE_IDS_KEY, hardwareKey } from './keys'
import type { BindingRecord, GatewayRecord, HardwareRecord } from './records'
import {
  deleteHardware,
  getBindings,
  getGateway,
  getHardware,
  listHardware,
  putGateway,
  putHardware,
  updateGateway,
  updateHardware,
  updateBindings,
} from './store'

const makeOps = () => createMemoryOps(createMemoryPubSub())

const hardware = (id: string): HardwareRecord => ({
  id,
  gatewayId: null,
  address: 'AA:BB:CC:DD:EE:FF',
  model: 'beurer-bf950',
  createdAt: 1,
  battery: null,
  lastReadingAt: null,
  scaleUsers: [],
})

const binding = (index: number): BindingRecord => ({
  hardwareId: 'h1',
  index,
  accountId: 'a1',
  consentCode: '1234',
  createdAt: 1,
  profileRevision: 0,
  appliedRevision: 0,
})

describe('hardware store', () => {
  it('putHardware twice keeps one index entry', async () => {
    const ops = makeOps()
    await putHardware(ops, hardware('h1'))
    await putHardware(ops, hardware('h1'))
    expect(JSON.parse((await ops.get(HARDWARE_IDS_KEY)) ?? '[]')).toEqual(['h1'])
    expect(await listHardware(ops)).toHaveLength(1)
  })

  it('deleteHardware removes record, bindings and index entry', async () => {
    const ops = makeOps()
    await putHardware(ops, hardware('h1'))
    await updateBindings(ops, 'h1', () => [binding(1)])
    await deleteHardware(ops, 'h1')
    expect(await ops.get(hardwareKey('h1'))).toBeNull()
    expect(await ops.get(bindingsKey('h1'))).toBeNull()
    expect(await getHardware(ops, 'h1')).toBeNull()
    expect(await listHardware(ops)).toEqual([])
  })

  it('concurrent updateBindings appends both survive', async () => {
    const ops = makeOps()
    await Promise.all([
      updateBindings(ops, 'h1', (c) => [...c, binding(1)]),
      updateBindings(ops, 'h1', (c) => [...c, binding(2)]),
    ])
    const list = await getBindings(ops, 'h1')
    expect(list).toHaveLength(2)
  })

  it('an update returning [] deletes the key', async () => {
    const ops = makeOps()
    await updateBindings(ops, 'h1', () => [binding(1)])
    await updateBindings(ops, 'h1', () => [])
    expect(await ops.get(bindingsKey('h1'))).toBeNull()
    expect(await getBindings(ops, 'h1')).toEqual([])
  })

  it('a corrupt record comes back as an Error', async () => {
    const ops = makeOps()
    await ops.set(hardwareKey('h1'), '{not json')
    expect(await getHardware(ops, 'h1')).toBeInstanceOf(Error)
  })
})

const gateway = (id: string): GatewayRecord => ({
  id,
  label: 'g',
  tokenHash: 'h',
  createdAt: 1,
  createdBy: 'a1',
  lastSeenAt: 1,
  connectedAt: null,
  adapter: null,
  bonded: [],
})

describe('updateGateway / updateHardware', () => {
  it('updateGateway on a missing id returns null and writes nothing', async () => {
    const ops = makeOps()
    expect(await updateGateway(ops, 'gx', (c) => ({ ...c, lastSeenAt: 5 }))).toBeNull()
    expect(await ops.get(gatewayKey('gx'))).toBeNull()
    expect(await ops.get(GATEWAY_IDS_KEY)).toBeNull()
  })

  it('concurrent updateGateway calls keep both changes', async () => {
    const ops = makeOps()
    await putGateway(ops, gateway('g1'))
    await Promise.all([
      updateGateway(ops, 'g1', (c) => ({ ...c, lastSeenAt: 9 })),
      updateGateway(ops, 'g1', (c) => ({ ...c, connectedAt: 7 })),
    ])
    expect(await getGateway(ops, 'g1')).toMatchObject({ lastSeenAt: 9, connectedAt: 7 })
  })

  it('concurrent updateHardware calls keep both changes', async () => {
    const ops = makeOps()
    await putHardware(ops, hardware('h1'))
    await Promise.all([
      updateHardware(ops, 'h1', (c) => ({ ...c, battery: 50 })),
      updateHardware(ops, 'h1', (c) => ({ ...c, lastReadingAt: 3 })),
    ])
    expect(await getHardware(ops, 'h1')).toMatchObject({ battery: 50, lastReadingAt: 3 })
  })

  it('deleteHardware waits for an update in flight, so it cannot write the record back', async () => {
    const ops = makeOps()
    await putHardware(ops, hardware('h1'))
    const read = Promise.withResolvers<void>()
    const gate = Promise.withResolvers<void>()
    // The update reads the record, then stalls before writing it.
    const stalled = {
      ...ops,
      async get(key: string) {
        const value = await ops.get(key)
        if (key === hardwareKey('h1')) {
          read.resolve()
          await gate.promise
        }
        return value
      },
    }
    const updating = updateHardware(stalled, 'h1', (c) => ({ ...c, battery: 50 }))
    await read.promise
    const deleting = deleteHardware(stalled, 'h1')
    // An unlocked delete finishes here, before the update writes.
    await new Promise((resolve) => setTimeout(resolve, 0))
    gate.resolve()
    expect(await updating).toMatchObject({ battery: 50 })
    expect(await deleting).toBeUndefined()
    expect(await ops.get(hardwareKey('h1'))).toBeNull()
    expect(await listHardware(ops)).toEqual([])
  })

  it('updateHardware on a missing id returns null', async () => {
    const ops = makeOps()
    expect(await updateHardware(ops, 'hx', (c) => c)).toBeNull()
    expect(await ops.get(hardwareKey('hx'))).toBeNull()
  })
})
