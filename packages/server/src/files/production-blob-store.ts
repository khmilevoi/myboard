import {
  makeBlobStoreFromEnv,
  makeDeferredBlobStore,
  usesS3BlobStore,
  type DeferredBlobStore,
  type FilesEnv,
} from './blob-store'

/**
 * The blob store the server entries hand to `createApp`. Without `FILES_S3_ENDPOINT` it is the
 * directory store, ready at once. With it, the store stays unavailable (file routes answer 503)
 * until the Garage bootstrap derives the S3 credentials and calls
 * `blobs.resolve(makeBlobStoreFromEnv({ env, credentials }))`.
 */
export function makeEntryBlobStore(env: FilesEnv): DeferredBlobStore {
  const blobs = makeDeferredBlobStore()
  if (usesS3BlobStore(env)) {
    console.warn('file storage waits for S3 credentials; file routes answer 503 until then')
    return blobs
  }
  const store = makeBlobStoreFromEnv({ env, credentials: null })
  if (store instanceof Error) console.error(store.message)
  else blobs.resolve(store)
  return blobs
}
