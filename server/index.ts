import { createServer, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import Router from 'find-my-way'
import { createValkeyOps, createValkeySubscriber } from './valkey'
import { readJsonBody } from './body'
import { handleGet, handlePut, handleDelete, handleKeys, publishChange, type HandlerResult } from './handlers'
import { PutPayloadSchema, PrefixQuerySchema, EventsBodySchema, formatZodError } from './schemas'
import { SseRegistry, writeSseEvent, fanout } from './sse'

const ops = createValkeyOps()
const router = Router({ ignoreTrailingSlash: true })

const registry = new SseRegistry()
createValkeySubscriber('storage:events', (message) => {
  try {
    fanout(registry, JSON.parse(message) as { key: string; value: unknown })
  } catch {
    // ignore malformed pub/sub payloads
  }
})
const HEARTBEAT_MS = 25_000

function send(res: ServerResponse, result: HandlerResult): void {
  if (result.body === undefined) {
    res.writeHead(result.status)
    res.end()
    return
  }
  res.writeHead(result.status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(result.body))
}

router.on('GET', '/api/storage/events', (req, res) => {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
  const connId = randomUUID()
  registry.add(connId, res)
  writeSseEvent(res, 'ready', { connId })
  const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS)
  req.on('close', () => {
    clearInterval(heartbeat)
    registry.remove(connId)
  })
})

router.on('POST', '/api/storage/events/:connId', async (req, res, params) => {
  let raw: unknown
  try {
    raw = await readJsonBody(req)
  } catch {
    res.writeHead(400)
    res.end()
    return
  }
  const parsed = EventsBodySchema.safeParse(raw ?? {})
  if (!parsed.success) {
    res.writeHead(422, { 'content-type': 'application/json' })
    res.end(JSON.stringify(formatZodError(parsed.error)))
    return
  }
  const connId = params.connId as string
  if (parsed.data.subscribe) registry.subscribe(connId, parsed.data.subscribe)
  if (parsed.data.unsubscribe) registry.unsubscribe(connId, parsed.data.unsubscribe)
  res.writeHead(204)
  res.end()
})

router.on('GET', '/api/storage', async (_req, res, _params, _store, query) => {
  const parsed = PrefixQuerySchema.safeParse(query ?? {})
  if (!parsed.success) {
    res.writeHead(422, { 'content-type': 'application/json' })
    res.end(JSON.stringify(formatZodError(parsed.error)))
    return
  }
  send(res, await handleKeys(ops, parsed.data.prefix ?? ''))
})

router.on('GET', '/api/storage/:key', async (_req, res, params) => {
  send(res, await handleGet(ops, decodeURIComponent(params.key as string)))
})

router.on('PUT', '/api/storage/:key', async (req, res, params) => {
  let raw: unknown
  try {
    raw = await readJsonBody(req)
  } catch (e) {
    const status = e instanceof Error && e.message === 'request body too large' ? 413 : 400
    res.writeHead(status)
    res.end()
    return
  }
  const parsed = PutPayloadSchema.safeParse(raw)
  if (!parsed.success) {
    res.writeHead(422, { 'content-type': 'application/json' })
    res.end(JSON.stringify(formatZodError(parsed.error)))
    return
  }
  const key = decodeURIComponent(params.key as string)
  send(res, await handlePut(ops, key, parsed.data))
  await publishChange(ops, key, parsed.data.value)
})

router.on('DELETE', '/api/storage/:key', async (_req, res, params) => {
  const key = decodeURIComponent(params.key as string)
  send(res, await handleDelete(ops, key))
  await publishChange(ops, key, null)
})

const port = Number(process.env.PORT ?? 8787)
createServer((req, res) => {
  Promise.resolve(router.lookup(req, res)).catch(() => {
    if (!res.writableEnded) {
      res.writeHead(500)
      res.end()
    }
  })
}).listen(port, () => {
  console.log(`storage-api listening on :${port}`)
})
