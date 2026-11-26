import {
  AVATAR_POLICY,
  IMAGE_MIME_TYPES,
  type FilePolicy,
  type FileRef,
} from '@shared/files/contract'
import { encodeWebp, initImageCodecs } from 'image-codec'
import { packageWasmLoader } from 'image-codec/node'
import { encodeJpeg, encodePng, gradientImage } from 'image-codec/testing'
import { beforeAll, describe, expect, it } from 'vitest'

import { EVENTS_CHANNEL } from '../storage/handlers'
import { PDF_BYTES, SVG_BYTES, pngBytes } from '../test/file-fixtures'
import { testImageDecoder } from '../test/image-decoder'
import { createMemoryOps, createMemoryPubSub } from '../test/memory-ops'
import type { BlobStore } from './blob-store'
import {
  FileForbiddenError,
  FileImageRejectedError,
  FileImageUndecodableError,
  FileNotFoundError,
  FileSessionRequiredError,
  FileStoreError,
  FileTooLargeError,
  FileTypeMismatchError,
  FileUnavailableError,
} from './errors'
import { makeDeferredImageDecoder } from './image-check'
import { makeMemoryBlobStore } from './memory-blob-store'
import { makeFilePolicies } from './policies'
import { blobRecordKey } from './records'
import { makeFileService, readStorageSlot, storageSlotIO, type SlotIO } from './service'

const SLOT = 'm:cats:s:@files/photo'

// Image types without pixel rules, so header-only fixtures do; the image-rule tests use real ones.
const PHOTO_POLICY: FilePolicy = { accept: IMAGE_MIME_TYPES, maxBytes: 2 * 1024 * 1024 }

function setup(blobs = makeMemoryBlobStore()) {
  const pubsub = createMemoryPubSub()
  const ops = createMemoryOps(pubsub)
  const events: unknown[] = []
  pubsub.subscribe(EVENTS_CHANNEL, (message) => events.push(JSON.parse(message)))
  const service = makeFileService({ ops, blobs, images: testImageDecoder, now: () => 1_000 })
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
      policy: PHOTO_POLICY,
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
      policy: PHOTO_POLICY,
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
      policy: PHOTO_POLICY,
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
      policy: PHOTO_POLICY,
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
      policy: PHOTO_POLICY,
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
      policy: PHOTO_POLICY,
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
        policy: PHOTO_POLICY,
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
      policy: PHOTO_POLICY,
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
      PHOTO_POLICY,
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

describe('file service image rules', () => {
  const writeAvatar = (
    service: ReturnType<typeof setup>['service'],
    ops: ReturnType<typeof setup>['ops'],
    bytes: Uint8Array,
    declaredType: string,
  ) =>
    service.writeSlot({
      slot: SLOT,
      access: { kind: 'members' },
      policy: AVATAR_POLICY,
      upload: upload(bytes, declaredType),
      io: storageSlotIO(ops, SLOT),
    })

  beforeAll(async () => {
    expect(await initImageCodecs(packageWasmLoader, { webpEncoder: true })).toBeUndefined()
  })

  it('stores a real 256x256 WebP avatar with its decoded size', async () => {
    const { ops, blobs, service } = setup()
    const webp = await encodeWebp(gradientImage(256, 256), { quality: 86 })
    if (webp instanceof Error) throw webp

    const ref = await writeAvatar(service, ops, webp, 'image/webp')
    if (ref instanceof Error) throw ref
    expect(ref).toMatchObject({ mime: 'image/webp', image: { width: 256, height: 256 } })
    expect(blobs.ids()).toEqual([ref.blobId])
  })

  it.each([
    ['a non-square image', 300, 200, 'not_square'],
    ['a square over maxSide', 1024, 1024, 'too_large'],
  ])('rejects %s with 422 and stores nothing', async (_label, width, height, reason) => {
    const { ops, blobs, service } = setup()
    const result = await writeAvatar(service, ops, encodePng(width, height), 'image/png')
    expect(result).toBeInstanceOf(FileImageRejectedError)
    expect(result).toMatchObject({ status: 422, code: 'file_image_rejected', reason })
    expect(blobs.ids()).toEqual([])
    expect(await readStorageSlot(ops, SLOT)).toBeNull()
  })

  it('rejects a PNG whose header sniffs fine but whose body does not decode with 415', async () => {
    const { ops, blobs, service } = setup()
    const truncated = encodePng(64, 64).subarray(0, 60)
    const result = await writeAvatar(service, ops, truncated, 'image/png')
    expect(result).toBeInstanceOf(FileImageUndecodableError)
    expect(result).toMatchObject({ status: 415, code: 'file_image_undecodable' })
    expect(blobs.ids()).toEqual([])
  })

  it('rejects a header-only PNG claiming a valid size with 415', async () => {
    const { ops, service } = setup()
    const result = await writeAvatar(service, ops, pngBytes(256, 256), 'image/png')
    expect(result).toBeInstanceOf(FileImageUndecodableError)
  })

  it('still answers a JPEG declared as WebP with the type mismatch', async () => {
    const { ops, service } = setup()
    const result = await writeAvatar(service, ops, await encodeJpeg(64, 64), 'image/webp')
    expect(result).toBeInstanceOf(FileTypeMismatchError)
  })

  it('answers 503 while the codecs are not ready', async () => {
    const pubsub = createMemoryPubSub()
    const ops = createMemoryOps(pubsub)
    const blobs = makeMemoryBlobStore()
    const decoder = makeDeferredImageDecoder()
    const service = makeFileService({ ops, blobs, images: decoder, now: () => 1_000 })
    const result = await writeAvatar(service, ops, encodePng(16, 16), 'image/png')
    expect(result).toBeInstanceOf(FileUnavailableError)
    expect(result).toMatchObject({ status: 503 })
    expect(blobs.ids()).toEqual([])

    decoder.markReady()
    expect(await writeAvatar(service, ops, encodePng(16, 16), 'image/png')).toMatchObject({
      image: { width: 16, height: 16 },
    })
  })
})
