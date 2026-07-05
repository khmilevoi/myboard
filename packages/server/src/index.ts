import { createApp } from './app'
import { loadBrowserGatewayConfig } from './browser/config'
import { createHttpBrowserAutomationClient } from './browser/http-client'
import { createValkeyOps, createValkeySubscriber } from './storage/valkey'
import { productionWidgetServerRegistry } from './widgets/production-registry'

const browserConfig = loadBrowserGatewayConfig(process.env)
if (browserConfig instanceof Error) {
  console.error(browserConfig.message)
  process.exit(1)
}

const browserClient = createHttpBrowserAutomationClient(browserConfig)

const { server } = createApp({
  ops: createValkeyOps(),
  subscribe: (onMessage) => createValkeySubscriber('storage:events', onMessage),
  now: Date.now,
  widgetRegistry: productionWidgetServerRegistry,
  browserClient,
})

const port = Number(process.env.PORT ?? 8787)
server.listen(port, () => {
  console.log(`storage-api listening on :${port}`)
})
