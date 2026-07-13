import { describe, expect, it } from 'vitest'

import {
  addDeviceToAccount,
  createAccount,
  getAccount,
  listAccountDeviceIds,
} from '../src/auth/accounts'
import { getDevice, storeDevice } from '../src/auth/devices'
import { AccountNotFoundError, DeviceNotFoundError } from '../src/auth/errors'
import { createMemoryOps, createMemoryPubSub } from '../src/test/memory-ops'
import { runRevokeDevices } from './revoke-devices'

const now = () => 1_700_000_000_000

function makeOps() {
  return createMemoryOps(createMemoryPubSub())
}

describe('runRevokeDevices', () => {
  it('revokes every device on the account but keeps the account itself', async () => {
    const ops = makeOps()
    const account = await createAccount(ops, now, { name: 'Dana', inviteId: 'inv' })
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

    const result = await runRevokeDevices(ops, account.id)

    expect(result).toEqual({ revoked: 2 })
    expect(await getAccount(ops, account.id)).not.toBeInstanceOf(Error)
    expect(await getDevice(ops, 'c1')).toBeInstanceOf(DeviceNotFoundError)
    expect(await getDevice(ops, 'c2')).toBeInstanceOf(DeviceNotFoundError)
    expect(await listAccountDeviceIds(ops, account.id)).toEqual([])
  })

  it('returns AccountNotFoundError for an unknown account', async () => {
    const ops = makeOps()
    expect(await runRevokeDevices(ops, 'missing')).toBeInstanceOf(AccountNotFoundError)
  })

  it('dry-run reports the device count without revoking anything', async () => {
    const ops = makeOps()
    const account = await createAccount(ops, now, { name: 'Erin', inviteId: 'inv' })
    await storeDevice(ops, {
      credentialId: 'c1',
      publicKey: 'pk',
      signCount: 0,
      label: 'c1',
      createdAt: now(),
      lastSeenAt: now(),
      disabled: false,
      accountId: account.id,
      status: 'active',
      addedVia: 'invite',
    })
    await addDeviceToAccount(ops, account.id, 'c1', { countsAgainstLimit: false })

    const result = await runRevokeDevices(ops, account.id, { dryRun: true })

    expect(result).toEqual({ revoked: 1 })
    expect(await getDevice(ops, 'c1')).not.toBeInstanceOf(Error)
    expect(await listAccountDeviceIds(ops, account.id)).toEqual(['c1'])
  })
})
