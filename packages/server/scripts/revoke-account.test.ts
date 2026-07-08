import { describe, expect, it } from 'vitest'

import { addDeviceToAccount, createAccount, getAccount } from '../src/auth/accounts'
import { getDevice, storeDevice } from '../src/auth/devices'
import { AccountNotFoundError, DeviceNotFoundError } from '../src/auth/errors'
import { createMemoryOps, createMemoryPubSub } from '../src/test/memory-ops'
import { runRevokeAccount } from './revoke-account'

const now = () => 1_700_000_000_000

describe('runRevokeAccount', () => {
  it('deletes the account, every device, and their sessions', async () => {
    const ops = createMemoryOps(createMemoryPubSub())
    const account = await createAccount(ops, now, { name: 'Carol', inviteId: 'inv' })
    for (const credentialId of ['c1', 'c2']) {
      await storeDevice(ops, {
        credentialId,
        publicKey: 'pk',
        signCount: 0,
        label: credentialId,
        createdAt: now(),
        lastSeenAt: now(),
        disabled: false,
        accountId: account.id,
        status: 'active',
        addedVia: 'invite',
      })
      await addDeviceToAccount(ops, account.id, credentialId, { countsAgainstLimit: false })
    }

    const result = await runRevokeAccount(ops, account.id)
    expect(result).toEqual({ devices: 2 })
    expect(await getAccount(ops, account.id)).toBeInstanceOf(AccountNotFoundError)
    expect(await getDevice(ops, 'c1')).toBeInstanceOf(DeviceNotFoundError)
    expect(await getDevice(ops, 'c2')).toBeInstanceOf(DeviceNotFoundError)
  })

  it('returns AccountNotFoundError for an unknown account', async () => {
    const ops = createMemoryOps(createMemoryPubSub())
    expect(await runRevokeAccount(ops, 'missing')).toBeInstanceOf(AccountNotFoundError)
  })
})
