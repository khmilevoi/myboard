import { createApp } from './app'
import { createValkeyOps, createValkeySubscriber } from './storage/valkey'
import { productionWidgetServerRegistry } from './widgets/production-registry'

const { server } = createApp({
  ops: createValkeyOps(),
  subscribe: (onMessage) => createValkeySubscriber('storage:events', onMessage),
  now: Date.now,
  widgetRegistry: productionWidgetServerRegistry,
})

const port = Number(process.env.PORT ?? 8787)
server.listen(port, () => {
  console.log(`storage-api listening on :${port}`)
})
