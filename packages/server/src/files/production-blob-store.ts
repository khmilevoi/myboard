import {
  makeBlobStoreFromEnv,
  makeDeferredBlobStore,
  usesS3BlobStore,
  type DeferredBlobStore,
  type FilesEnv,
} from './blob-store'
import {
  loadGarageBootstrapConfig,
  startGarageBootstrap,
  type GarageBootstrapEnv,
} from './garage-bootstrap'

/**
 * The blob store the server entries hand to `createApp`. Without `FILES_S3_ENDPOINT` it is the
 * directory store, ready at once. With it, the store stays unavailable (file routes answer 503)
 * until `startEntryBlobStoreBootstrap` has derived the S3 credentials from Garage.
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

/**
 * With `FILES_S3_ENDPOINT` set, bootstraps Garage in the background (retrying with backoff) and
 * plugs the S3 store into `blobs` once it succeeds. A missing admin URL or token file is logged
 * and leaves file routes at 503 — the rest of the server keeps working. No-op otherwise.
 */
export function startEntryBlobStoreBootstrap(options: {
  env: FilesEnv & GarageBootstrapEnv
  blobs: DeferredBlobStore
}): void {
  const { env, blobs } = options
  if (!usesS3BlobStore(env)) return
  const config = loadGarageBootstrapConfig(env)
  if (config instanceof Error) {
    console.error(`file storage stays unavailable: ${config.message}`)
    return
  }
  startGarageBootstrap({
    config,
    onReady: (credentials) => {
      const store = makeBlobStoreFromEnv({ env, credentials })
      if (store instanceof Error) {
        console.error(`file storage stays unavailable: ${store.message}`)
        return
      }
      blobs.resolve(store)
      console.log(`file storage ready: Garage bucket ${config.bucket}`)
    },
  })
}
