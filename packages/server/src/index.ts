import path from 'node:path'

import { directoryWasmLoader } from 'image-codec/node'

import { createApp } from './app'
import { loadAuthConfig } from './auth/config'
import { loadBrowserGatewayConfig } from './browser/config'
import { createHttpBrowserAutomationClient } from './browser/http-client'
import { makeDeferredImageDecoder, startImageCodecs } from './files/image-check'
import { makeEntryBlobStore, startEntryBlobStoreBootstrap } from './files/production-blob-store'
import { MigrationFailedError, productionMigrations, runMigrations } from './migrations'
import { productionModuleServerRegistry } from './modules/production-registry'
import { productionFilePolicies } from './storage/production-file-policies'
import { productionScopedOwners } from './storage/production-scoped-owners'
import { createValkeyOps, createValkeySubscriber } from './storage/valkey'
import { makeTestControls } from './test-controls'
import { productionWidgetServerRegistry } from './widgets/production-registry'

const browserConfig = loadBrowserGatewayConfig(process.env)
if (browserConfig instanceof Error) {
  console.error(browserConfig.message)
  process.exit(1)
}

const authConfig = loadAuthConfig(process.env)
if (authConfig instanceof Error) {
  console.error(authConfig.message)
  process.exit(1)
}

const browserClient = createHttpBrowserAutomationClient(browserConfig)

const ops = createValkeyOps()
const testSetup = process.env.ALLOW_TEST_DB_RESET === '1' ? makeTestControls(ops) : undefined

// With FILES_S3_ENDPOINT set, file routes answer 503 until the Garage bootstrap succeeds.
const blobs = makeEntryBlobStore(process.env)
startEntryBlobStoreBootstrap({ env: process.env, blobs })

// Image-rule uploads answer 503 until the codecs, shipped as dist/wasm/*.wasm, have compiled.
const images = makeDeferredImageDecoder()
startImageCodecs({ decoder: images, loadWasm: directoryWasmLoader(path.join(__dirname, 'wasm')) })

const { server, startCron } = createApp({
  ops,
  subscribe: (onMessage) => createValkeySubscriber('storage:events', onMessage),
  now: testSetup?.now ?? Date.now,
  widgetRegistry: productionWidgetServerRegistry,
  moduleRegistry: productionModuleServerRegistry,
  browserClient,
  authConfig,
  scopedOwners: productionScopedOwners,
  files: { blobs, policies: productionFilePolicies, images },
  recovery: browserConfig.recovery,
  ...(testSetup ? { testControls: testSetup.controls } : {}),
})

const port = Number(process.env.PORT ?? 8787)

// The bundle is CJS, so no top-level await: migrations finish before the listener opens.
// runMigrations returns its failures as values; the catch only formats an unexpected rejection
// the same way, so a Valkey outage at boot exits with a message instead of an unhandled rejection.
void runMigrations(ops, productionMigrations, Date.now)
  .catch((e) => new MigrationFailedError({ migration: 'productionMigrations', cause: e }))
  .then((migrated) => {
    if (migrated instanceof Error) {
      console.error(migrated.message, migrated.cause)
      process.exit(1)
    }
    server.listen(port, () => {
      console.log(`storage-api listening on :${port}`)
    })
    startCron()
  })
