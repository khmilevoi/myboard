import { createApp } from './app'
import { loadAuthConfig } from './auth/config'
import { loadBrowserGatewayConfig } from './browser/config'
import { createHttpBrowserAutomationClient } from './browser/http-client'
import { productionMigrations, runMigrations } from './migrations'
import { productionModuleServerRegistry } from './modules/production-registry'
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

const { server, startCron } = createApp({
  ops,
  subscribe: (onMessage) => createValkeySubscriber('storage:events', onMessage),
  now: testSetup?.now ?? Date.now,
  widgetRegistry: productionWidgetServerRegistry,
  moduleRegistry: productionModuleServerRegistry,
  browserClient,
  authConfig,
  scopedOwners: productionScopedOwners,
  recovery: browserConfig.recovery,
  ...(testSetup ? { testControls: testSetup.controls } : {}),
})

const port = Number(process.env.PORT ?? 8787)

// The bundle is CJS, so no top-level await: migrations finish before the listener opens.
void runMigrations(ops, productionMigrations, Date.now).then((migrated) => {
  if (migrated instanceof Error) {
    console.error(migrated.message, migrated.cause)
    process.exit(1)
  }
  server.listen(port, () => {
    console.log(`storage-api listening on :${port}`)
  })
  startCron()
})
