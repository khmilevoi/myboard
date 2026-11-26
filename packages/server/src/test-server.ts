import path from 'node:path'

import { directoryWasmLoader } from 'image-codec/node'

import { createApp } from './app'
import { loadAuthConfig } from './auth/config'
import { loadBrowserGatewayConfig } from './browser/config'
import { createHttpBrowserAutomationClient } from './browser/http-client'
import { makeDeferredImageDecoder, startImageCodecs } from './files/image-check'
import { makeEntryBlobStore, startEntryBlobStoreBootstrap } from './files/production-blob-store'
import { productionMigrations, runMigrations } from './migrations'
import { productionModuleServerRegistry } from './modules/production-registry'
import { EVENTS_CHANNEL } from './storage/handlers'
import { productionFilePolicies } from './storage/production-file-policies'
import { productionScopedOwners } from './storage/production-scoped-owners'
import { createValkeySubscriber, createValkeyTestOps } from './storage/valkey'
import { productionWidgetServerRegistry } from './widgets/production-registry'

// Dedicated e2e entry. Running this bundle (vs dist/index.cjs) IS the
// test-mode gate: it exposes /api/test/* control routes and a settable clock.
// Storage and pub/sub are the real Valkey-backed implementations (same as
// production), so e2e tests exercise the real system end to end; only the
// test-only control routes and clock stay app-only. Requires VALKEY_URL to be
// reachable (docker-compose.e2e.yml provides a disposable instance). The
// production entry (index.ts) never imports this file, so test routes can't
// leak to prod. /api/test/reset also requires ALLOW_TEST_DB_RESET=1 as an
// explicit opt-in confirming VALKEY_URL points at a disposable instance,
// so the destructive FLUSHDB can't fire against a shared dev/prod Valkey
// by accident.
// Each Playwright worker runs its own test-server against its own Valkey
// database (`redis://host:6379/<n>`), so reset/FLUSHDB and the settable clock
// are per worker. Pub/sub, however, ignores the database index: every channel
// is server-wide. Namespacing the channel by database keeps one worker's SSE
// events (e.g. the shared ofelia ledger key) out of another worker's browser.
const valkeyDb = new URL(process.env.VALKEY_URL ?? 'redis://localhost:6379').pathname.slice(1)
const channelOf = (channel: string): string =>
  valkeyDb === '' || valkeyDb === '0' ? channel : `db${valkeyDb}:${channel}`

const valkeyOps = createValkeyTestOps()
const ops: typeof valkeyOps = {
  ...valkeyOps,
  publish: (channel, message) => valkeyOps.publish(channelOf(channel), message),
}
let currentNow = Date.now()

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

// With FILES_S3_ENDPOINT set, file routes answer 503 until the Garage bootstrap succeeds.
const blobs = makeEntryBlobStore(process.env)
startEntryBlobStoreBootstrap({ env: process.env, blobs })

// Image-rule uploads answer 503 until the codecs, shipped as dist/wasm/*.wasm, have compiled.
const images = makeDeferredImageDecoder()
startImageCodecs({ decoder: images, loadWasm: directoryWasmLoader(path.join(__dirname, 'wasm')) })

const { server } = createApp({
  ops,
  subscribe: (onMessage) => createValkeySubscriber(channelOf(EVENTS_CHANNEL), onMessage),
  now: () => currentNow,
  widgetRegistry: productionWidgetServerRegistry,
  moduleRegistry: productionModuleServerRegistry,
  browserClient,
  authConfig,
  scopedOwners: productionScopedOwners,
  files: { blobs, policies: productionFilePolicies, images },
  recovery: browserConfig.recovery,
  testControls: {
    setNow: (ms) => {
      currentNow = ms
    },
    reset: async () => {
      if (process.env['ALLOW_TEST_DB_RESET'] !== '1') {
        throw new Error(
          'Refusing to flush Valkey: set ALLOW_TEST_DB_RESET=1 to confirm this VALKEY_URL points at a disposable instance',
        )
      }
      await ops.clear()
      currentNow = Date.now()
    },
  },
})

const port = Number(process.env.PORT ?? 8787)

// The bundle is CJS, so no top-level await: migrations finish before the listener opens.
void runMigrations(ops, productionMigrations, Date.now).then((migrated) => {
  if (migrated instanceof Error) {
    console.error(migrated.message, migrated.cause)
    process.exit(1)
  }
  server.listen(port, () => {
    console.log(`test storage-api listening on :${port}`)
  })
})
