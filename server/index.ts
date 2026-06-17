import { createServer, type ServerResponse } from 'node:http'
import Router from 'find-my-way'
import { createValkeyOps } from './valkey'
import { readJsonBody } from './body'
import { handleGet, handlePut, handleDelete, handleKeys, type HandlerResult } from './handlers'
import { PutPayloadSchema, PrefixQuerySchema, formatZodError } from './schemas'

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
  send(res, await handlePut(ops, decodeURIComponent(params.key as string), parsed.data))
})

router.on('DELETE', '/api/storage/:key', async (_req, res, params) => {
  send(res, await handleDelete(ops, decodeURIComponent(params.key as string)))
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
