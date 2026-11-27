import { describe, expect, it } from 'vitest'

import { createMemoryOps, createMemoryPubSub } from '../test/memory-ops'
import { bindingsKey, HARDWARE_IDS_KEY, hardwareKey } from './keys'
import type { BindingRecord, HardwareRecord } from './records'
import {
  deleteHardware,
  getBindings,
  getHardware,
  listHardware,
  putHardware,
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
