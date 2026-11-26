import { AVATAR_POLICY, type FileRef } from '@shared/files/contract'
import { describe, expect, it } from 'vitest'

import { EVENTS_CHANNEL } from '../storage/handlers'
import { PDF_BYTES, SVG_BYTES, pngBytes } from '../test/file-fixtures'
import { createMemoryOps, createMemoryPubSub } from '../test/memory-ops'
import type { BlobStore } from './blob-store'
import {
  FileForbiddenError,
  FileNotFoundError,
  FileSessionRequiredError,
  FileStoreError,
  FileTooLargeError,
  FileTypeMismatchError,
} from './errors'
import { makeMemoryBlobStore } from './memory-blob-store'
import { makeFilePolicies } from './policies'
import { blobRecordKey } from './records'
import { makeFileService, readStorageSlot, storageSlotIO, type SlotIO } from './service'

const SLOT = 'm:cats:s:@files/photo'

function setup(blobs = makeMemoryBlobStore()) {
  const pubsub = createMemoryPubSub()
  const ops = createMemoryOps(pubsub)
  const events: unknown[] = []
  pubsub.subscribe(EVENTS_CHANNEL, (message) => events.push(JSON.parse(message)))
  const service = makeFileService({ ops, blobs, now: () => 1_000 })
  return { ops, blobs, service, events }
}

const upload = (bytes = pngBytes(8, 8), declaredType = 'image/png') => ({
  bytes,
  declaredType,
  name: null,
})

describe('file service writeSlot', () => {
  it('stores the blob, its record and the ref, and publishes the change', async () => {
    const { ops, blobs, service, events } = setup()
    const ref = (await service.writeSlot({
      slot: SLOT,
      access: { kind: 'members' },
      policy: AVATAR_POLICY,
      upload: upload(),
      io: storageSlotIO(ops, SLOT),
    })) as FileRef

    expect(ref).toEqual({
      blobId: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
      url: `/files/${ref.blobId}`,
      mime: 'image/png',
      size: pngBytes(8, 8).byteLength,
      image: { width: 8, height: 8 },
      updatedAt: 1_000,
    })
    expect(blobs.ids()).toEqual([ref.blobId])
    expect(await readStorageSlot(ops, SLOT)).toEqual(ref)
    expect(JSON.parse((await ops.get(blobRecordKey(ref.blobId))) as string)).toEqual({
      blobId: ref.blobId,
      slot: SLOT,
      access: { kind: 'members' },
      mime: 'image/png',
      size: ref.size,
      image: { width: 8, height: 8 },
      disposition: 'inline',
      createdAt: 1_000,
    })
    expect(events).toEqual([{ key: SLOT, value: ref }])
  })

  it('records the file name and an attachment disposition for a download-only type', async () => {
    const { ops, service } = setup()
    const ref = (await service.writeSlot({
      slot: SLOT,
      access: { kind: 'account', accountId: 'acc-1' },
      policy: { accept: ['*/*'], maxBytes: 1000 },
      upload: { bytes: SVG_BYTES, declaredType: 'image/svg+xml', name: 'logo.svg' },
      io: storageSlotIO(ops, SLOT),
    })) as FileRef
    expect(ref).toMatchObject({ mime: 'image/svg+xml', name: 'logo.svg' })
    expect(ref.image).toBeUndefined()
    const record = JSON.parse((await ops.get(blobRecordKey(ref.blobId))) as string)
    expect(record.disposition).toBe(`attachment; filename="logo.svg"; filename*=UTF-8''logo.svg`)
    expect(record.access).toEqual({ kind: 'account', accountId: 'acc-1' })
  })

  it('replacing deletes the old blob and record', async () => {
    const { ops, blobs, service } = setup()
    const write = (bytes: Uint8Array, declaredType: string) =>
      service.writeSlot({
        slot: SLOT,
        access: { kind: 'members' },
        policy: { accept: ['image/png', 'application/pdf'], maxBytes: 1000 },
        upload: upload(bytes, declaredType),
        io: storageSlotIO(ops, SLOT),
      }) as Promise<FileRef>
    const first = await write(pngBytes(1, 1), 'image/png')
    const second = await write(PDF_BYTES, 'application/pdf')

    expect(blobs.ids()).toEqual([second.blobId])
    expect(await ops.get(blobRecordKey(first.blobId))).toBeNull()
    expect(await ops.get(blobRecordKey(second.blobId))).not.toBeNull()
    expect(await readStorageSlot(ops, SLOT)).toEqual(second)
  })

  it('clearing deletes the blob, the record and the slot, and publishes null', async () => {
    const { ops, blobs, service, events } = setup()
    const ref = (await service.writeSlot({
      slot: SLOT,
      access: { kind: 'members' },
      policy: AVATAR_POLICY,
      upload: upload(),
      io: storageSlotIO(ops, SLOT),
    })) as FileRef
    expect(await service.clearSlot(storageSlotIO(ops, SLOT))).toBeUndefined()

    expect(blobs.ids()).toEqual([])
    expect(await ops.get(blobRecordKey(ref.blobId))).toBeNull()
    expect(await ops.get(SLOT)).toBeNull()
    expect(events.at(-1)).toEqual({ key: SLOT, value: null })

    // An empty slot clears without publishing anything new.
    const before = events.length
    expect(await service.clearSlot(storageSlotIO(ops, SLOT))).toBeUndefined()
    expect(events).toHaveLength(before)
  })

  it('refuses before storing anything: 413 and 415', async () => {
    const { ops, blobs, service } = setup()
    const tooLarge = await service.writeSlot({
      slot: SLOT,
      access: { kind: 'members' },
      policy: { accept: ['*/*'], maxBytes: 4 },
      upload: upload(),
      io: storageSlotIO(ops, SLOT),
    })
    expect(tooLarge).toBeInstanceOf(FileTooLargeError)
    const mismatch = await service.writeSlot({
      slot: SLOT,
      access: { kind: 'members' },
      policy: AVATAR_POLICY,
      upload: upload(SVG_BYTES, 'image/png'),
      io: storageSlotIO(ops, SLOT),
    })
    expect(mismatch).toBeInstanceOf(FileTypeMismatchError)
    expect(blobs.ids()).toEqual([])
    expect(await ops.scanKeys('files:')).toEqual([])
  })

  it('a failed slot write removes the new blob and record and keeps the old one', async () => {
    const { ops, blobs, service } = setup()
    const first = (await service.writeSlot({
      slot: SLOT,
      access: { kind: 'members' },
      policy: AVATAR_POLICY,
      upload: upload(),
      io: storageSlotIO(ops, SLOT),
    })) as FileRef
    const failing: SlotIO = {
      ...storageSlotIO(ops, SLOT),
      write: async () => {
        throw new Error('valkey down')
      },
    }
    const result = await service.writeSlot({
      slot: SLOT,
      access: { kind: 'members' },
      policy: AVATAR_POLICY,
      upload: upload(),
      io: failing,
    })
    expect(result).toBeInstanceOf(FileStoreError)
    expect(blobs.ids()).toEqual([first.blobId])
    expect(await ops.scanKeys('files:blob:')).toEqual([blobRecordKey(first.blobId)])
    expect(await readStorageSlot(ops, SLOT)).toEqual(first)
  })

  it('a failed blob put stores nothing', async () => {
    const memory = makeMemoryBlobStore()
    const broken: BlobStore = {
      ...memory,
      put: async (blobId) => new FileStoreError({ operation: 'put', blobId }),
    }
    const { ops, service } = setup(broken as typeof memory)
    const result = await service.writeSlot({
      slot: SLOT,
      access: { kind: 'members' },
      policy: AVATAR_POLICY,
      upload: upload(),
      io: storageSlotIO(ops, SLOT),
    })
    expect(result).toBeInstanceOf(FileStoreError)
    expect(await ops.scanKeys('')).toEqual([])
  })
})

describe('file service authorize', () => {
  async function seeded() {
    const ctx = setup()
    const write = (access: Parameters<typeof ctx.service.writeSlot>[0]['access'], slot: string) =>
      ctx.service.writeSlot({
        slot,
        access,
        policy: AVATAR_POLICY,
        upload: upload(),
        io: storageSlotIO(ctx.ops, slot),
      }) as Promise<FileRef>
    const shared = await write({ kind: 'members' }, SLOT)
    const own = await write({ kind: 'account', accountId: 'acc-1' }, 'm:cats:a:acc-1:@files/p')
    return { ...ctx, shared, own }
  }

  it('lets any session read a members blob', async () => {
    const { service, shared } = await seeded()
    expect(await service.authorize({ blobId: shared.blobId, accountId: 'acc-2' })).toMatchObject({
      blobId: shared.blobId,
    })
  })

  it('lets only the owning account read an account blob', async () => {
    const { service, own } = await seeded()
    expect(await service.authorize({ blobId: own.blobId, accountId: 'acc-1' })).toMatchObject({
      blobId: own.blobId,
    })
    const other = await service.authorize({ blobId: own.blobId, accountId: 'acc-2' })
    expect(other).toBeInstanceOf(FileForbiddenError)
    expect((other as FileForbiddenError).status).toBe(403)
  })

  it('requires a session before anything else', async () => {
    const { service, shared } = await seeded()
    const result = await service.authorize({ blobId: shared.blobId, accountId: null })
    expect(result).toBeInstanceOf(FileSessionRequiredError)
    expect((result as FileSessionRequiredError).status).toBe(401)
  })

  it('answers 404 for an unknown, malformed or replaced blob', async () => {
    const { ops, service, shared } = await seeded()
    expect(
      await service.authorize({ blobId: 'UnknownUnknownUnknown1', accountId: 'acc-1' }),
    ).toBeInstanceOf(FileNotFoundError)
    expect(await service.authorize({ blobId: '../x', accountId: 'acc-1' })).toBeInstanceOf(
      FileNotFoundError,
    )
    await service.clearSlot(storageSlotIO(ops, SLOT))
    expect(await service.authorize({ blobId: shared.blobId, accountId: 'acc-1' })).toBeInstanceOf(
      FileNotFoundError,
    )
  })

  it('readFile returns the bytes once authorized', async () => {
    const { service, shared, own } = await seeded()
    const read = await service.readFile({ blobId: shared.blobId, accountId: 'acc-9' })
    expect(read).toMatchObject({ record: { mime: 'image/png' }, bytes: pngBytes(8, 8) })
    expect(await service.readFile({ blobId: own.blobId, accountId: 'acc-9' })).toBeInstanceOf(
      FileForbiddenError,
    )
  })
})

describe('makeFilePolicies', () => {
  const policies = makeFilePolicies([
    {
      owner: 'module',
      id: 'cats',
      scope: 'shared',
      keyPattern: /^photo\/\w+$/,
      policy: AVATAR_POLICY,
    },
    {
      owner: 'module',
      id: 'cats',
      scope: 'account',
      keyPattern: 'docs/',
      policy: { accept: ['*/*'], maxBytes: 10 },
    },
  ])

  it('resolves by branch and key, denying everything undeclared', () => {
    expect(policies.resolve({ owner: 'module', id: 'cats', scope: 'shared' }, 'photo/a')).toBe(
      AVATAR_POLICY,
    )
    expect(
      policies.resolve({ owner: 'module', id: 'cats', scope: 'shared' }, 'photo/a/b'),
    ).toBeNull()
    expect(
      policies.resolve({ owner: 'module', id: 'cats', scope: 'account' }, 'docs/x'),
    ).toMatchObject({ maxBytes: 10 })
    expect(
      policies.resolve({ owner: 'module', id: 'cats', scope: 'account' }, 'photo/a'),
    ).toBeNull()
    expect(policies.resolve({ owner: 'module', id: 'dogs', scope: 'shared' }, 'photo/a')).toBeNull()
  })
})
