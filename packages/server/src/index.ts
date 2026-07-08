import { createApp } from './app'
import { loadAuthConfig } from './auth/config'
import { loadBrowserGatewayConfig } from './browser/config'
import { createHttpBrowserAutomationClient } from './browser/http-client'
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

const { server } = createApp({
  ops,
  subscribe: (onMessage) => createValkeySubscriber('storage:events', onMessage),
  now: testSetup?.now ?? Date.now,
  widgetRegistry: productionWidgetServerRegistry,
  browserClient,
  authConfig,
  ...(testSetup ? { testControls: testSetup.controls } : {}),
})

const port = Number(process.env.PORT ?? 8787)
server.listen(port, () => {
  console.log(`storage-api listening on :${port}`)
})
