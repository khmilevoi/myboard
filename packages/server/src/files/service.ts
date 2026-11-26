import {
  FileRefSchema,
  fileUrl,
  isValidBlobId,
  type FileRef,
  type FilePolicy,
} from '@shared/files/contract'
import { JSONParseError, safeParse } from '@shared/json'

import { getJson, setJson } from '../auth/records'
import { randomId } from '../auth/tokens'
import { publishChange } from '../storage/handlers'
import { runExclusive } from '../storage/key-lock'
import type { ValkeyOps } from '../storage/valkey'
import type { BlobStore } from './blob-store'
import {
  FileForbiddenError,
  FileNotFoundError,
  FileSessionRequiredError,
  FileStoreError,
} from './errors'
import { BlobRecordSchema, blobRecordKey, type BlobRecord, type FileAccess } from './records'
import { contentDisposition, inspectUpload } from './upload'

/**
 * How the service reaches one slot. `read` answers the blob id the slot holds now; `write` stores
 * the new ref (or clears it with null). Both run inside `runExclusive(lockKey)`.
 */
export type SlotIO = {
  lockKey: string
  read: () => Promise<string | null>
  write: (ref: FileRef | null) => Promise<void>
}

export type FileUpload = {
  bytes: Uint8Array
  declaredType: string | undefined
  name: string | null
}

export type FileService = ReturnType<typeof makeFileService>

export function makeFileService(deps: { ops: ValkeyOps; blobs: BlobStore; now: () => number }) {
  const { ops, blobs, now } = deps

  // Record first: once it is gone the blob can never be authorized, so a failed object delete
  // only leaves a harmless orphan.
  async function discard(blobId: string): Promise<void> {
    const unrecorded = await ops
      .del(blobRecordKey(blobId))
      .catch((cause) => new FileStoreError({ operation: 'unrecord', blobId, cause }))
    if (unrecorded instanceof Error) {
      console.warn(unrecorded.message, unrecorded.cause)
      return
    }
    const deleted = await blobs.delete(blobId)
    if (deleted instanceof Error) console.warn(deleted.message, deleted.cause)
  }

  async function swap(io: SlotIO, ref: FileRef | null) {
    const operation = ref === null ? 'clear' : 'swap'
    const blobId = ref?.blobId ?? 'none'
    return runExclusive(io.lockKey, async () => {
      const old = await io.read().catch((cause) => new FileStoreError({ operation, blobId, cause }))
      if (old instanceof Error) return old
      if (ref === null && old === null) return
      const written = await io
        .write(ref)
        .catch((cause) => new FileStoreError({ operation, blobId, cause }))
      if (written instanceof Error) return written
      if (old !== null && old !== ref?.blobId) await discard(old)
    })
  }

  /**
   * Validates the upload against the slot's policy, stores it as a new blob with its record, then
   * swaps it into the slot and discards the blob the slot held before. A failure before the swap
   * completes removes the new blob again.
   */
  async function writeSlot(options: {
    slot: string
    access: FileAccess
    policy: FilePolicy
    upload: FileUpload
    io: SlotIO
  }) {
    const { slot, access, policy, upload, io } = options
    const inspected = inspectUpload({ ...upload, policy })
    if (inspected instanceof Error) return inspected

    const blobId = randomId(16)
    const put = await blobs.put(blobId, upload.bytes, inspected.mime)
    if (put instanceof Error) return put

    const createdAt = now()
    const record: BlobRecord = {
      blobId,
      slot,
      access,
      mime: inspected.mime,
      size: inspected.size,
      ...(inspected.name !== null ? { name: inspected.name } : {}),
      ...(inspected.image !== null ? { image: inspected.image } : {}),
      disposition: contentDisposition(inspected.mime, inspected.name),
      createdAt,
    }
    const recorded = await setJson(ops, blobRecordKey(blobId), record).catch(
      (cause) => new FileStoreError({ operation: 'record', blobId, cause }),
    )
    if (recorded instanceof Error) {
      const deleted = await blobs.delete(blobId)
      if (deleted instanceof Error) console.warn(deleted.message, deleted.cause)
      return recorded
    }

    const ref: FileRef = {
      blobId,
      url: fileUrl(blobId),
      mime: record.mime,
      size: record.size,
      ...(record.name !== undefined ? { name: record.name } : {}),
      ...(record.image !== undefined ? { image: record.image } : {}),
      updatedAt: createdAt,
    }
    const swapped = await swap(io, ref)
    if (swapped instanceof Error) {
      await discard(blobId)
      return swapped
    }
    return ref
  }

  /** Empties the slot and discards its blob; an already-empty slot is fine. */
  async function clearSlot(io: SlotIO) {
    return swap(io, null)
  }

  /**
   * The per-blob read check behind both nginx's `auth_request` and the Node fallback route: a
   * session is required, the blob must have a record, and an account blob is that account's only.
   */
  async function authorize(options: { blobId: string; accountId: string | null }) {
    const { blobId, accountId } = options
    if (accountId === null) return new FileSessionRequiredError()
    if (!isValidBlobId(blobId)) return new FileNotFoundError({ blobId })

    const record = await getJson(ops, blobRecordKey(blobId), BlobRecordSchema)
    if (record instanceof Error)
      return new FileStoreError({ operation: 'authorize', blobId, cause: record })
    if (record === null) return new FileNotFoundError({ blobId })
    if (record.access.kind === 'account' && record.access.accountId !== accountId) {
      return new FileForbiddenError({ blobId })
    }
    return record
  }

  /** `authorize`, then the bytes — the dev/e2e fallback for what nginx serves in production. */
  async function readFile(options: { blobId: string; accountId: string | null }) {
    const record = await authorize(options)
    if (record instanceof Error) return record
    const blob = await blobs.get(record.blobId)
    if (blob instanceof Error) return blob
    if (blob === null) return new FileNotFoundError({ blobId: record.blobId })
    return { record, bytes: blob.bytes }
  }

  /** Deletes a blob and its record outright (account revocation). */
  async function discardBlob(blobId: string): Promise<void> {
    await discard(blobId)
  }

  return { writeSlot, clearSlot, authorize, readFile, discardBlob }
}

/** The ref a storage slot holds, or null when it is empty or unreadable. */
export async function readStorageSlot(ops: ValkeyOps, fullKey: string): Promise<FileRef | null> {
  const raw = await ops.get(fullKey)
  if (raw === null) return null
  const parsed = safeParse(raw)
  if (parsed instanceof JSONParseError) return null
  const ref = FileRefSchema.safeParse(parsed)
  return ref.success ? ref.data : null
}

/**
 * A storage slot at `<namespace>@files/<key>`: the ref JSON is stored at the full key exactly as
 * `handlePut` stores a value, and every change is published under that key, so SSE subscribers
 * of the `@files/<key>` relative key see it like any other scoped change.
 */
export function storageSlotIO(ops: ValkeyOps, fullKey: string): SlotIO {
  return {
    lockKey: fullKey,
    read: async () => (await readStorageSlot(ops, fullKey))?.blobId ?? null,
    write: async (ref) => {
      if (ref === null) await ops.del(fullKey)
      else await ops.set(fullKey, JSON.stringify(ref))
      await publishChange(ops, fullKey, ref)
    },
  }
}
