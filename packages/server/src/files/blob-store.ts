import { FileUnavailableError, type FileStoreError } from './errors'
import { makeFsBlobStore } from './fs-blob-store'
import { makeS3BlobStore, type S3Credentials } from './s3-blob-store'

export type StoredBlob = { bytes: Uint8Array; mime: string }

/**
 * Where blob bytes live. Blobs are immutable: a blob id is written once and only ever deleted.
 * Failures are values; an unavailable store answers `FileUnavailableError` (503).
 */
export type BlobStore = {
  put(blobId: string, bytes: Uint8Array, mime: string): Promise<void | BlobStoreError>
  delete(blobId: string): Promise<void | BlobStoreError>
  get(blobId: string): Promise<StoredBlob | null | BlobStoreError>
}

export type BlobStoreError = FileStoreError | FileUnavailableError

export type DeferredBlobStore = BlobStore & {
  /** Plugs in the real store; until then every call answers `FileUnavailableError`. */
  resolve(store: BlobStore): void
  isReady(): boolean
}

/**
 * A store that becomes usable later — production builds the S3 store only once the Garage
 * bootstrap has produced credentials, and file routes answer 503 until then.
 */
export function makeDeferredBlobStore(): DeferredBlobStore {
  let inner: BlobStore | null = null
  const unavailable = () => new FileUnavailableError({ reason: 'blob store is not ready' })
  return {
    resolve(store) {
      inner = store
    },
    isReady: () => inner !== null,
    put: async (blobId, bytes, mime) =>
      inner === null ? unavailable() : inner.put(blobId, bytes, mime),
    delete: async (blobId) => (inner === null ? unavailable() : inner.delete(blobId)),
    get: async (blobId) => (inner === null ? unavailable() : inner.get(blobId)),
  }
}

export type FilesEnv = Partial<
  Record<'FILES_S3_ENDPOINT' | 'FILES_S3_BUCKET' | 'FILES_S3_REGION' | 'FILES_FS_DIR', string>
>

export const DEFAULT_FILES_BUCKET = 'files'
export const DEFAULT_FILES_FS_DIR = '.data/files'

/** True when this environment stores files in S3 (Garage) rather than on the local disk. */
export function usesS3BlobStore(env: FilesEnv): boolean {
  return (env.FILES_S3_ENDPOINT ?? '') !== ''
}

/**
 * `FILES_S3_ENDPOINT` set → the S3 (Garage) store, which needs the credentials the Garage
 * bootstrap derives; without them this answers `FileUnavailableError`. Otherwise a directory
 * store at `FILES_FS_DIR` (default `.data/files`), for host-run dev and e2e.
 */
export function makeBlobStoreFromEnv(options: {
  env: FilesEnv
  credentials: S3Credentials | null
  fetch?: typeof globalThis.fetch
}): BlobStore | FileUnavailableError {
  const { env, credentials } = options
  if (!usesS3BlobStore(env)) return makeFsBlobStore(env.FILES_FS_DIR || DEFAULT_FILES_FS_DIR)
  if (credentials === null) {
    return new FileUnavailableError({ reason: 'S3 credentials are not bootstrapped yet' })
  }
  return makeS3BlobStore({
    endpoint: env.FILES_S3_ENDPOINT as string,
    bucket: env.FILES_S3_BUCKET || DEFAULT_FILES_BUCKET,
    ...(env.FILES_S3_REGION ? { region: env.FILES_S3_REGION } : {}),
    credentials,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  })
}
