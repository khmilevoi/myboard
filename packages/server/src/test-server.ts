import { createApp } from './app'
import { loadAuthConfig } from './auth/config'
import { loadBrowserGatewayConfig } from './browser/config'
import { createHttpBrowserAutomationClient } from './browser/http-client'
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
const ops = createValkeyTestOps()
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

const { server } = createApp({
  ops,
  subscribe: (onMessage) => createValkeySubscriber('storage:events', onMessage),
  now: () => currentNow,
  widgetRegistry: productionWidgetServerRegistry,
  browserClient,
  authConfig,
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
server.listen(port, () => {
  console.log(`test storage-api listening on :${port}`)
})
