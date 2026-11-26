import { checkBlobId } from './blob-id'
import type { BlobStore, StoredBlob } from './blob-store'

export type MemoryBlobStore = BlobStore & {
  /** The ids currently stored, for test assertions. */
  ids(): string[]
}

export function makeMemoryBlobStore(): MemoryBlobStore {
  const blobs = new Map<string, StoredBlob>()
  return {
    async put(blobId, bytes, mime) {
      const invalid = checkBlobId('put', blobId)
      if (invalid !== null) return invalid
      blobs.set(blobId, { bytes: bytes.slice(), mime })
    },
    async delete(blobId) {
      const invalid = checkBlobId('delete', blobId)
      if (invalid !== null) return invalid
      blobs.delete(blobId)
    },
    async get(blobId) {
      if (checkBlobId('get', blobId) !== null) return null
      const blob = blobs.get(blobId)
      return blob === undefined ? null : { bytes: blob.bytes.slice(), mime: blob.mime }
    },
    ids: () => [...blobs.keys()],
  }
}
