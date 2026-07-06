import { describe, expect, it } from 'vitest'

import { createMemoryOps, createMemoryPubSub } from '../test/memory-ops'
import {
  addDeviceToAccount,
  createAccount,
  getAccount,
  listAccountDeviceIds,
  removeDeviceFromAccount,
} from './accounts'
import { storeDevice } from './devices'
import { AccountNotFoundError, DeviceLimitError } from './errors'
import type { DeviceRecord } from './records'

function makeOps() {
  return createMemoryOps(createMemoryPubSub())
}

function makeClock(start = 0) {
  let time = start
  return {
    now: () => time,
    set: (value: number) => {
      time = value
    },
  }
}

function makeDevice(overrides: Partial<DeviceRecord> = {}): DeviceRecord {
  return {
    credentialId: 'cred-1',
    publicKey: 'pk',
    signCount: 0,
    label: 'Board device',
    createdAt: 0,
    lastSeenAt: 0,
    disabled: false,
    accountId: 'acc-1',
    status: 'active',
    addedVia: 'invite',
    ...overrides,
  }
}

describe('createAccount', () => {
  it('creates an account record with defaults and an empty device list', async () => {
    const ops = makeOps()
    const clock = makeClock(1_000)

    const record = await createAccount(ops, clock.now, { name: 'Household', inviteId: 'inv-1' })

    expect(record).toEqual({
      id: expect.any(String),
      name: 'Household',
      createdAt: 1_000,
      inviteId: 'inv-1',
      deviceLimit: 10,
    })
    const deviceIds = await listAccountDeviceIds(ops, record.id)
    expect(deviceIds).toEqual([])
  })

  it('honors a custom deviceLimit', async () => {
    const ops = makeOps()
    const clock = makeClock(1_000)

    const record = await createAccount(ops, clock.now, {
      name: 'Household',
      inviteId: 'inv-1',
      deviceLimit: 3,
    })

    expect(record.deviceLimit).toBe(3)
  })
})

describe('getAccount', () => {
  it('returns the stored account record', async () => {
    const ops = makeOps()
    const clock = makeClock(1_000)
    const created = await createAccount(ops, clock.now, { name: 'Household', inviteId: 'inv-1' })

    const result = await getAccount(ops, created.id)

    expect(result).toEqual(created)
  })

  it('returns AccountNotFoundError for a missing account', async () => {
    const ops = makeOps()

    const result = await getAccount(ops, 'missing')

    expect(result).toBeInstanceOf(AccountNotFoundError)
  })
})

describe('addDeviceToAccount', () => {
  it('adds device ids up to the deviceLimit', async () => {
    const ops = makeOps()
    const clock = makeClock(1_000)
    const account = await createAccount(ops, clock.now, {
      name: 'Household',
      inviteId: 'inv-1',
      deviceLimit: 2,
    })

    await storeDevice(ops, makeDevice({ credentialId: 'cred-1', accountId: account.id }))
    const first = await addDeviceToAccount(ops, account.id, 'cred-1', { countsAgainstLimit: true })
    expect(first).toBeUndefined()

    await storeDevice(ops, makeDevice({ credentialId: 'cred-2', accountId: account.id }))
    const second = await addDeviceToAccount(ops, account.id, 'cred-2', {
      countsAgainstLimit: true,
    })
    expect(second).toBeUndefined()

    const ids = await listAccountDeviceIds(ops, account.id)
    expect(ids).toEqual(['cred-1', 'cred-2'])
  })

  it('rejects with DeviceLimitError when adding an active device would exceed deviceLimit', async () => {
    const ops = makeOps()
    const clock = makeClock(1_000)
    const account = await createAccount(ops, clock.now, {
      name: 'Household',
      inviteId: 'inv-1',
      deviceLimit: 1,
    })

    await storeDevice(ops, makeDevice({ credentialId: 'cred-1', accountId: account.id }))
    const first = await addDeviceToAccount(ops, account.id, 'cred-1', { countsAgainstLimit: true })
    expect(first).toBeUndefined()

    await storeDevice(ops, makeDevice({ credentialId: 'cred-2', accountId: account.id }))
    const second = await addDeviceToAccount(ops, account.id, 'cred-2', {
      countsAgainstLimit: true,
    })

    expect(second).toBeInstanceOf(DeviceLimitError)
    const ids = await listAccountDeviceIds(ops, account.id)
    expect(ids).toEqual(['cred-1'])
  })

  it('does not enforce the limit when countsAgainstLimit is false', async () => {
    const ops = makeOps()
    const clock = makeClock(1_000)
    const account = await createAccount(ops, clock.now, {
      name: 'Household',
      inviteId: 'inv-1',
      deviceLimit: 1,
    })

    await storeDevice(ops, makeDevice({ credentialId: 'cred-1', accountId: account.id }))
    await addDeviceToAccount(ops, account.id, 'cred-1', { countsAgainstLimit: true })

    await storeDevice(
      ops,
      makeDevice({ credentialId: 'cred-2', accountId: account.id, status: 'pending' }),
    )
    const result = await addDeviceToAccount(ops, account.id, 'cred-2', {
      countsAgainstLimit: false,
    })

    expect(result).toBeUndefined()
    const ids = await listAccountDeviceIds(ops, account.id)
    expect(ids).toEqual(['cred-1', 'cred-2'])
  })

  it('dedups an id that is already in the list', async () => {
    const ops = makeOps()
    const clock = makeClock(1_000)
    const account = await createAccount(ops, clock.now, {
      name: 'Household',
      inviteId: 'inv-1',
      deviceLimit: 5,
    })

    await storeDevice(ops, makeDevice({ credentialId: 'cred-1', accountId: account.id }))
    await addDeviceToAccount(ops, account.id, 'cred-1', { countsAgainstLimit: true })
    await addDeviceToAccount(ops, account.id, 'cred-1', { countsAgainstLimit: true })

    const ids = await listAccountDeviceIds(ops, account.id)
    expect(ids).toEqual(['cred-1'])
  })
})

describe('removeDeviceFromAccount', () => {
  it('removes the id from the account device list', async () => {
    const ops = makeOps()
    const clock = makeClock(1_000)
    const account = await createAccount(ops, clock.now, {
      name: 'Household',
      inviteId: 'inv-1',
      deviceLimit: 5,
    })
    await storeDevice(ops, makeDevice({ credentialId: 'cred-1', accountId: account.id }))
    await storeDevice(ops, makeDevice({ credentialId: 'cred-2', accountId: account.id }))
    await addDeviceToAccount(ops, account.id, 'cred-1', { countsAgainstLimit: true })
    await addDeviceToAccount(ops, account.id, 'cred-2', { countsAgainstLimit: true })

    await removeDeviceFromAccount(ops, account.id, 'cred-1')

    const ids = await listAccountDeviceIds(ops, account.id)
    expect(ids).toEqual(['cred-2'])
  })
})
