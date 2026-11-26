import fs from 'node:fs/promises'
import path from 'node:path'

import { checkBlobId } from './blob-id'
import type { BlobStore } from './blob-store'
import { FileStoreError } from './errors'

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

/**
 * Blobs as files: `<dir>/<blobId>` holds the bytes and `<dir>/<blobId>.mime` the type. The id is
 * checked against `BLOB_ID_PATTERN` before any path is built, so it can never escape `dir`.
 */
export function makeFsBlobStore(dir: string): BlobStore {
  const root = path.resolve(dir)
  const bytesPath = (blobId: string) => path.join(root, blobId)
  const mimePath = (blobId: string) => path.join(root, `${blobId}.mime`)

  return {
    async put(blobId, bytes, mime) {
      const invalid = checkBlobId('put', blobId)
      if (invalid !== null) return invalid
      const fail = (cause: unknown) => new FileStoreError({ operation: 'put', blobId, cause })

      const made = await fs.mkdir(root, { recursive: true }).catch(fail)
      if (made instanceof Error) return made
      // The type first: a reader treats a blob without bytes as missing, never as untyped.
      const typed = await fs.writeFile(mimePath(blobId), mime, 'utf8').catch(fail)
      if (typed instanceof Error) return typed
      const written = await fs.writeFile(bytesPath(blobId), bytes).catch(fail)
      if (written instanceof Error) return written
    },

    async delete(blobId) {
      const invalid = checkBlobId('delete', blobId)
      if (invalid !== null) return invalid
      const removed = await Promise.all([
        fs.rm(bytesPath(blobId), { force: true }),
        fs.rm(mimePath(blobId), { force: true }),
      ]).catch((cause) => new FileStoreError({ operation: 'delete', blobId, cause }))
      if (removed instanceof Error) return removed
    },

    async get(blobId) {
      if (checkBlobId('get', blobId) !== null) return null
      const read = await Promise.all([
        fs.readFile(bytesPath(blobId)),
        fs.readFile(mimePath(blobId), 'utf8'),
      ]).catch((cause: unknown) =>
        isMissing(cause) ? null : new FileStoreError({ operation: 'get', blobId, cause }),
      )
      if (read === null || read instanceof Error) return read
      const [bytes, mime] = read
      return { bytes: new Uint8Array(bytes), mime: mime.trim() }
    },
  }
}
