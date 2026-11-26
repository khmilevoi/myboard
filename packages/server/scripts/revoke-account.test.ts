import { AVATAR_POLICY } from '@shared/files/contract'
import { encodePng } from 'image-codec/testing'
import { describe, expect, it } from 'vitest'

import { addDeviceToAccount, createAccount, getAccount } from '../src/auth/accounts'
import { getDevice, storeDevice } from '../src/auth/devices'
import { AccountNotFoundError, DeviceNotFoundError } from '../src/auth/errors'
import { accountAvatarIO, avatarSlotName } from '../src/files/account-avatar'
import { makeMemoryBlobStore } from '../src/files/memory-blob-store'
import { blobRecordKey } from '../src/files/records'
import { makeFileService } from '../src/files/service'
import { testImageDecoder } from '../src/test/image-decoder'
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
    expect(result).toEqual({ devices: 2, avatar: false })
    expect(await getAccount(ops, account.id)).toBeInstanceOf(AccountNotFoundError)
    expect(await getDevice(ops, 'c1')).toBeInstanceOf(DeviceNotFoundError)
    expect(await getDevice(ops, 'c2')).toBeInstanceOf(DeviceNotFoundError)
  })

  it('deletes the avatar blob and its record', async () => {
    const ops = createMemoryOps(createMemoryPubSub())
    const blobs = makeMemoryBlobStore()
    const account = await createAccount(ops, now, { name: 'Dana', inviteId: 'inv' })
    const ref = await makeFileService({ ops, blobs, images: testImageDecoder, now }).writeSlot({
      slot: avatarSlotName(account.id),
      access: { kind: 'members' },
      policy: AVATAR_POLICY,
      upload: { bytes: encodePng(4, 4), declaredType: 'image/png', name: null },
      io: accountAvatarIO(ops, account.id),
    })
    if (ref instanceof Error) throw ref

    expect(await runRevokeAccount(ops, account.id, { blobs })).toEqual({
      devices: 0,
      avatar: true,
    })
    expect(blobs.ids()).toEqual([])
    expect(await ops.get(blobRecordKey(ref.blobId))).toBeNull()
  })

  it('without a blob store still drops the avatar record', async () => {
    const ops = createMemoryOps(createMemoryPubSub())
    const blobs = makeMemoryBlobStore()
    const account = await createAccount(ops, now, { name: 'Eve', inviteId: 'inv' })
    const ref = await makeFileService({ ops, blobs, images: testImageDecoder, now }).writeSlot({
      slot: avatarSlotName(account.id),
      access: { kind: 'members' },
      policy: AVATAR_POLICY,
      upload: { bytes: encodePng(4, 4), declaredType: 'image/png', name: null },
      io: accountAvatarIO(ops, account.id),
    })
    if (ref instanceof Error) throw ref

    await runRevokeAccount(ops, account.id)
    expect(await ops.get(blobRecordKey(ref.blobId))).toBeNull()
    expect(blobs.ids()).toEqual([ref.blobId])
  })

  it('returns AccountNotFoundError for an unknown account', async () => {
    const ops = createMemoryOps(createMemoryPubSub())
    expect(await runRevokeAccount(ops, 'missing')).toBeInstanceOf(AccountNotFoundError)
  })
})
