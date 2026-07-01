import { createApp } from './app'
import { createMemoryOps, createMemoryPubSub } from './test/memory-ops'
import { productionWidgetServerRegistry } from './widgets/production-registry'

// Dedicated e2e entry. Running this bundle (vs dist/index.cjs) IS the test-mode
// gate: in-memory storage, an in-process pub/sub so the SSE fanout fires without
// Valkey, a settable clock, and the /api/test/* control routes. The production
// entry (index.ts) never imports this file, so test routes can't leak to prod.
const pubsub = createMemoryPubSub()
const ops = createMemoryOps(pubsub)
let currentNow = Date.now()

const { server } = createApp({
  ops,
  subscribe: (onMessage) => pubsub.subscribe('storage:events', onMessage),
  now: () => currentNow,
  widgetRegistry: productionWidgetServerRegistry,
  testControls: {
    setNow: (ms) => {
      currentNow = ms
    },
    reset: () => {
      ops.clear()
      currentNow = Date.now()
    },
  },
})

const port = Number(process.env.PORT ?? 8787)
server.listen(port, () => {
  console.log(`test storage-api listening on :${port}`)
})
