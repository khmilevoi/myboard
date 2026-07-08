import { describe, expect, it } from 'vitest'

import { createAccount, listAccountDeviceIds, addDeviceToAccount } from '../src/auth/accounts'
import { getDevice, storeDevice } from '../src/auth/devices'
import { DeviceNotFoundError } from '../src/auth/errors'
import { sessionKey } from '../src/auth/records'
import { createMemoryOps, createMemoryPubSub } from '../src/test/memory-ops'
import { runRevokeDevice } from './revoke-device'

const now = () => 1_700_000_000_000

describe('runRevokeDevice', () => {
  it('deletes the device, its account link, and its sessions', async () => {
    const ops = createMemoryOps(createMemoryPubSub())
    const account = await createAccount(ops, now, { name: 'Bob', inviteId: 'inv-1' })
    await storeDevice(ops, {
      credentialId: 'cred-1',
      publicKey: 'pk',
      signCount: 0,
      label: 'iPad',
      createdAt: now(),
      lastSeenAt: now(),
      disabled: false,
      accountId: account.id,
      status: 'active',
      addedVia: 'invite',
    })
    await addDeviceToAccount(ops, account.id, 'cred-1', { countsAgainstLimit: false })
    await ops.set(
      sessionKey('s1'),
      JSON.stringify({
        sessionId: 's1',
        accountId: account.id,
        credentialId: 'cred-1',
        createdAt: now(),
        expiresAt: now() + 1000,
        absoluteExpiresAt: now() + 1000,
        lastSeenAt: now(),
      }),
    )

    const result = await runRevokeDevice(ops, 'cred-1')
    expect(result).toEqual({ accountId: account.id })
    expect(await getDevice(ops, 'cred-1')).toBeInstanceOf(DeviceNotFoundError)
    expect(await listAccountDeviceIds(ops, account.id)).toEqual([])
    expect(await ops.get(sessionKey('s1'))).toBeNull()
  })

  it('returns DeviceNotFoundError for an unknown credential', async () => {
    const ops = createMemoryOps(createMemoryPubSub())
    expect(await runRevokeDevice(ops, 'nope')).toBeInstanceOf(DeviceNotFoundError)
  })
})
