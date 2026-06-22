import { createApp } from './app'
import { createValkeyOps, createValkeySubscriber } from './storage/valkey'

const { server } = createApp({
  ops: createValkeyOps(),
  subscribe: (onMessage) => createValkeySubscriber('storage:events', onMessage),
  now: Date.now,
})

const port = Number(process.env.PORT ?? 8787)
server.listen(port, () => {
  console.log(`storage-api listening on :${port}`)
})
