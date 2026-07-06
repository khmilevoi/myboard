import { describe, expect, it } from 'vitest'

import { createMemoryOps, createMemoryPubSub } from '../test/memory-ops'
import { addDeviceToAccount, createAccount, listAccountDeviceIds } from './accounts'
import {
  getDevice,
  listAllDeviceCredentialIds,
  listDevices,
  revokeDevice,
  setDeviceStatus,
  storeDevice,
  updateSignCount,
} from './devices'
import { DeviceNotFoundError } from './errors'
import type { DeviceRecord } from './records'

function makeOps() {
  return createMemoryOps(createMemoryPubSub())
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

describe('storeDevice / getDevice', () => {
  it('stores and retrieves a device record', async () => {
    const ops = makeOps()
    const device = makeDevice()

    await storeDevice(ops, device)
    const result = await getDevice(ops, device.credentialId)

    expect(result).toEqual(device)
  })

  it('returns DeviceNotFoundError for a missing device', async () => {
    const ops = makeOps()

    const result = await getDevice(ops, 'missing')

    expect(result).toBeInstanceOf(DeviceNotFoundError)
  })
})

describe('listDevices', () => {
  it('returns stored records and skips ids with no record', async () => {
    const ops = makeOps()
    const account = await createAccount(ops, () => 0, { name: 'Household', inviteId: 'inv-1' })
    const accountId = account.id
    await storeDevice(ops, makeDevice({ credentialId: 'cred-1', accountId }))
    await addDeviceToAccount(ops, accountId, 'cred-1', { countsAgainstLimit: true })
    // simulate an id referencing a record that no longer exists
    await addDeviceToAccount(ops, accountId, 'cred-missing', { countsAgainstLimit: false })

    const result = await listDevices(ops, accountId)

    expect(result).toEqual([makeDevice({ credentialId: 'cred-1', accountId })])
  })
})

describe('listAllDeviceCredentialIds', () => {
  it('returns every stored device id across accounts', async () => {
    const ops = makeOps()
    await storeDevice(ops, makeDevice({ credentialId: 'cred-1', accountId: 'acc-1' }))
    await storeDevice(ops, makeDevice({ credentialId: 'cred-2', accountId: 'acc-2' }))

    const result = await listAllDeviceCredentialIds(ops)

    expect(result.sort()).toEqual(['cred-1', 'cred-2'])
  })
})

describe('setDeviceStatus', () => {
  it('flips the status to active and persists it', async () => {
    const ops = makeOps()
    await storeDevice(ops, makeDevice({ status: 'pending' }))

    const result = await setDeviceStatus(ops, 'cred-1', 'active')

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) throw result
    expect(result.status).toBe('active')

    const stored = await getDevice(ops, 'cred-1')
    expect(stored).not.toBeInstanceOf(Error)
    if (stored instanceof Error) throw stored
    expect(stored.status).toBe('active')
  })

  it('returns DeviceNotFoundError for a missing device', async () => {
    const ops = makeOps()

    const result = await setDeviceStatus(ops, 'missing', 'active')

    expect(result).toBeInstanceOf(DeviceNotFoundError)
  })
})

describe('updateSignCount', () => {
  it('persists the new sign count', async () => {
    const ops = makeOps()
    await storeDevice(ops, makeDevice({ signCount: 0 }))

    await updateSignCount(ops, 'cred-1', 5)

    const stored = await getDevice(ops, 'cred-1')
    expect(stored).not.toBeInstanceOf(Error)
    if (stored instanceof Error) throw stored
    expect(stored.signCount).toBe(5)
  })
})

describe('revokeDevice', () => {
  it('deletes the device key and removes the id from its account set', async () => {
    const ops = makeOps()
    const account = await createAccount(ops, () => 0, { name: 'Household', inviteId: 'inv-1' })
    const accountId = account.id
    await storeDevice(ops, makeDevice({ credentialId: 'cred-1', accountId }))
    await addDeviceToAccount(ops, accountId, 'cred-1', { countsAgainstLimit: true })

    await revokeDevice(ops, 'cred-1')

    const result = await getDevice(ops, 'cred-1')
    expect(result).toBeInstanceOf(DeviceNotFoundError)
    const ids = await listAccountDeviceIds(ops, accountId)
    expect(ids).toEqual([])
  })

  it('is a no-op when the device is already missing', async () => {
    const ops = makeOps()

    await expect(revokeDevice(ops, 'missing')).resolves.toBeUndefined()
  })

  it('serializes against a concurrent sign-count update so the device stays deleted', async () => {
    const ops = makeOps()
    const account = await createAccount(ops, () => 0, { name: 'Household', inviteId: 'inv-1' })
    const accountId = account.id
    await storeDevice(ops, makeDevice({ credentialId: 'cred-1', accountId, signCount: 5 }))
    await addDeviceToAccount(ops, accountId, 'cred-1', { countsAgainstLimit: true })

    // Simulates login's runExclusive(deviceKey(...), getDevice -> verify -> updateSignCount)
    // critical section racing with revokeDevice on the same device key.
    const { runExclusive } = await import('../storage/key-lock')
    const { deviceKey } = await import('./records')
    const loginCriticalSection = runExclusive(deviceKey('cred-1'), async () => {
      await updateSignCount(ops, 'cred-1', 6)
    })

    await Promise.all([loginCriticalSection, revokeDevice(ops, 'cred-1')])

    const result = await getDevice(ops, 'cred-1')
    expect(result).toBeInstanceOf(DeviceNotFoundError)
  })
})
