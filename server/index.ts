import { createServer, type ServerResponse } from 'node:http'
import Router from 'find-my-way'
import { createValkeyOps } from './valkey'
import { readJsonBody } from './body'
import { handleGet, handlePut, handleDelete, handleKeys, type HandlerResult } from './handlers'

const ops = createValkeyOps()
const router = Router({ ignoreTrailingSlash: true })

function send(res: ServerResponse, result: HandlerResult): void {
  if (result.body === undefined) {
    res.writeHead(result.status)
    res.end()
    return
  }
  res.writeHead(result.status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(result.body))
}

router.on('GET', '/api/storage', async (_req, res, _params, _store, query) => {
  const prefix = query && typeof query.prefix === 'string' ? query.prefix : ''
  send(res, await handleKeys(ops, prefix))
})

router.on('GET', '/api/storage/:key', async (_req, res, params) => {
  send(res, await handleGet(ops, decodeURIComponent(params.key as string)))
})

router.on('PUT', '/api/storage/:key', async (req, res, params) => {
  let payload: unknown
  try {
    payload = await readJsonBody(req)
  } catch {
    res.writeHead(400)
    res.end()
    return
  }
  if (payload == null || typeof payload !== 'object' || !('value' in payload)) {
    res.writeHead(400)
    res.end()
    return
  }
  send(res, await handlePut(ops, decodeURIComponent(params.key as string), payload as { value: unknown; ttlMs?: number }))
})

router.on('DELETE', '/api/storage/:key', async (_req, res, params) => {
  send(res, await handleDelete(ops, decodeURIComponent(params.key as string)))
})

const port = Number(process.env.PORT ?? 8787)
createServer((req, res) => {
  router.lookup(req, res)
}).listen(port, () => {
  console.log(`storage-api listening on :${port}`)
})
