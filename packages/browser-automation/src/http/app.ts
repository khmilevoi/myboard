import { createServer, type Server, type ServerResponse } from 'node:http'

import Router from 'find-my-way'

import { BrowserServiceUnavailableError, toEnvelopeError } from '../errors'
import { TaskRequestSchema } from '../schemas'
import type { BrowserService } from '../service'
import { readJsonBody } from './body'

export type BrowserHttpApp = { server: Server; close: () => Promise<void> }

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

export function makeBrowserHttpApp(service: BrowserService): BrowserHttpApp {
  const router = Router({ ignoreTrailingSlash: true })

  router.on('GET', '/health', (_req, res) => {
    const health = service.health()
    sendJson(res, health.healthy ? 200 : 503, { status: health.status })
  })

  router.on('POST', '/tasks/:widgetId/:taskId', async (req, res, params) => {
    let raw: unknown
    try {
      raw = await readJsonBody(req)
    } catch {
      res.writeHead(400)
      res.end()
      return
    }
    const parsed = TaskRequestSchema.safeParse(raw ?? {})
    const payload = parsed.success ? parsed.data.payload : undefined

    const outcome = await service.invoke({
      widgetId: decodeURIComponent(params.widgetId as string),
      taskId: decodeURIComponent(params.taskId as string),
      payload,
    })

    if (outcome instanceof BrowserServiceUnavailableError) {
      sendJson(res, 503, { status: 'draining' })
      return
    }
    if (outcome instanceof Error) {
      sendJson(res, 200, { ok: false, error: toEnvelopeError(outcome) })
      return
    }
    sendJson(res, 200, { ok: true, result: outcome })
  })

  const server = createServer((req, res) => {
    Promise.resolve(router.lookup(req, res)).catch(() => {
      if (!res.writableEnded) {
        res.writeHead(500)
        res.end()
      }
    })
  })

  const close = () => new Promise<void>((resolve) => server.close(() => resolve()))
  return { server, close }
}
