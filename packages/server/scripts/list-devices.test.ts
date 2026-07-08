import { describe, expect, it } from 'vitest'

import { createAccount } from '../src/auth/accounts'
import { storeDevice } from '../src/auth/devices'
import { createMemoryOps, createMemoryPubSub } from '../src/test/memory-ops'
import { runListDevices } from './list-devices'

const now = () => 1_700_000_000_000

async function seed(ops: ReturnType<typeof createMemoryOps>) {
  const account = await createAccount(ops, now, { name: 'Alice', inviteId: 'inv-1' })
  await storeDevice(ops, {
    credentialId: 'cred-1',
    publicKey: 'pk',
    signCount: 0,
    label: 'Chrome on Windows',
    createdAt: now(),
    lastSeenAt: now(),
    disabled: false,
    accountId: account.id,
    status: 'active',
    addedVia: 'invite',
  })
  return account
}

describe('runListDevices', () => {
  it('groups devices by account with the account name', async () => {
    const ops = createMemoryOps(createMemoryPubSub())
    const account = await seed(ops)

    const listing = await runListDevices(ops)
    expect(listing).toHaveLength(1)
    expect(listing[0]).toMatchObject({ accountId: account.id, accountName: 'Alice' })
    expect(listing[0].devices).toEqual([
      expect.objectContaining({ credentialId: 'cred-1', status: 'active', disabled: false }),
    ])
  })

  it('returns [] on an empty store', async () => {
    const ops = createMemoryOps(createMemoryPubSub())
    expect(await runListDevices(ops)).toEqual([])
  })
})
