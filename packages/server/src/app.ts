import { randomUUID } from 'node:crypto'
import { createServer, type Server, type ServerResponse } from 'node:http'

import Router from 'find-my-way'
import { z } from 'zod'

import { registerAuthRoutes } from './auth'
import type { AuthConfig } from './auth/config'
import { createInvite } from './auth/invites'
import { authAccountKey } from './auth/records'
import { isAuthResult, requireSession } from './auth/session-guard'
import type { BrowserAutomationClient } from './browser/client'
import { readJsonBody } from './http/body'
import { clientIp } from './http/client-ip'
import { SseRegistry, writeSseEvent, fanout } from './realtime/sse'
import {
  handleGet,
  handlePut,
  handleDelete,
  handleKeys,
  handleAppend,
  handleTime,
  publishChange,
  type HandlerResult,
} from './storage/handlers'
import { runExclusive } from './storage/key-lock'
import {
  PutPayloadSchema,
  PrefixQuerySchema,
  AppendPayloadSchema,
  EventsBodySchema,
  EventsParamsSchema,
  StorageEventSchema,
  TestTimeSchema,
  formatZodError,
} from './storage/schemas'
import type { ValkeyOps } from './storage/valkey'
import { dispatchWidgetEvent } from './widgets/dispatch'
import { WidgetRequestBodyError, type PublicWidgetDispatchError } from './widgets/errors'
import type { WidgetServerRegistry } from './widgets/registry'

const HEARTBEAT_MS = 25_000
const WidgetRequestSchema = z.object({
  instanceId: z.string().min(1),
  payload: z.unknown(),
})

const SeedInviteBodySchema = z.object({
  ttlMs: z.number().positive().optional(),
  maxUses: z.number().int().positive().optional(),
  label: z.string().optional(),
})

export type TestControls = {
  setNow: (ms: number) => void
  reset: () => Promise<void> | void
}

export type AppDeps = {
  ops: ValkeyOps
  subscribe: (onMessage: (message: string) => void) => () => void
  now: () => number
  widgetRegistry: WidgetServerRegistry
  browserClient: BrowserAutomationClient
  authConfig: AuthConfig
  testControls?: TestControls
}

export type App = {
  server: Server
  close: () => Promise<void>
}

export function createApp(deps: AppDeps): App {
  const { ops, now } = deps
  const router = Router({ ignoreTrailingSlash: true })
  const registry = new SseRegistry()
  const authDeps = { ops, config: deps.authConfig, now }

  const unsubscribe = deps.subscribe((message) => {
    let raw: unknown
    try {
      raw = JSON.parse(message) as unknown
    } catch (cause) {
      console.warn('invalid storage pub/sub JSON', cause)
      return
    }
    const parsed = StorageEventSchema.safeParse(raw)
    if (!parsed.success) {
      console.warn('invalid storage pub/sub event', parsed.error)
      return
    }
    fanout(registry, parsed.data)
  })

  function send(res: ServerResponse, result: HandlerResult): void {
    if (result.body === undefined) {
      res.writeHead(result.status)
      res.end()
      return
    }
    res.writeHead(result.status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(result.body))
  }

  function sendWidgetError(res: ServerResponse, error: PublicWidgetDispatchError): void {
    if (error.status === 500) console.error(error)
    res.writeHead(error.status, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        error: { code: error.code, message: error.publicMessage },
      }),
    )
  }

  registerAuthRoutes({ router, ...authDeps })

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
    const parsedParams = EventsParamsSchema.safeParse(params)
    if (!parsedParams.success) {
      res.writeHead(422, { 'content-type': 'application/json' })
      res.end(JSON.stringify(formatZodError(parsedParams.error)))
      return
    }
    const { connId } = parsedParams.data

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
    if (parsed.data.subscribe) registry.subscribe(connId, parsed.data.subscribe)
    if (parsed.data.unsubscribe) registry.unsubscribe(connId, parsed.data.unsubscribe)
    res.writeHead(204)
    res.end()
  })

  router.on('GET', '/api/auth/devices/events', async (req, res) => {
    const session = await requireSession(authDeps, req)
    if (isAuthResult(session)) {
      res.writeHead(session.status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(session.body))
      return
    }

    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    const connId = randomUUID()
    registry.add(connId, res)
    // Server-scoped: this account only ever sees its own device events.
    registry.subscribe(connId, [authAccountKey(session.accountId)])
    writeSseEvent(res, 'ready', { connId })
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS)
    req.on('close', () => {
      clearInterval(heartbeat)
      registry.remove(connId)
    })
  })

  router.on('GET', '/api/time', (_req, res) => {
    send(res, handleTime(now))
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

  router.on('POST', '/api/storage/:key/append', async (req, res, params) => {
    let raw: unknown
    try {
      raw = await readJsonBody(req)
    } catch (e) {
      const status = e instanceof Error && e.message === 'request body too large' ? 413 : 400
      res.writeHead(status)
      res.end()
      return
    }

    const parsed = AppendPayloadSchema.safeParse(raw)
    if (!parsed.success) {
      res.writeHead(422, { 'content-type': 'application/json' })
      res.end(JSON.stringify(formatZodError(parsed.error)))
      return
    }

    const key = decodeURIComponent(params.key as string)
    const ip = clientIp(req)
    const status = await runExclusive(key, async () => {
      const result = await handleAppend(ops, key, parsed.data, ip)
      await publishChange(ops, key, result.value)
      return result.status
    })

    res.writeHead(status)
    res.end()
  })

  router.on('DELETE', '/api/storage/:key', async (_req, res, params) => {
    const key = decodeURIComponent(params.key as string)
    send(res, await handleDelete(ops, key))
    await publishChange(ops, key, null)
  })

  router.on('POST', '/api/widgets/:typeId/:event', async (req, res, params) => {
    const raw = await readJsonBody(req).catch((cause) => new WidgetRequestBodyError({ cause }))
    if (raw instanceof WidgetRequestBodyError) {
      const tooLarge = raw.cause instanceof Error && raw.cause.message === 'request body too large'
      res.writeHead(tooLarge ? 413 : 400, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          error: {
            code: tooLarge ? 'body_too_large' : 'invalid_json',
            message: tooLarge ? 'Request body is too large' : 'Request JSON is invalid',
          },
        }),
      )
      return
    }

    const body = WidgetRequestSchema.safeParse(raw)
    if (!body.success) {
      res.writeHead(422, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          error: { code: 'request_invalid', message: 'Widget request is invalid' },
        }),
      )
      return
    }

    const result = await dispatchWidgetEvent({
      registry: deps.widgetRegistry,
      ops,
      browserClient: deps.browserClient,
      typeId: decodeURIComponent(params.typeId as string),
      event: decodeURIComponent(params.event as string),
      instanceId: body.data.instanceId,
      payload: body.data.payload,
      ip: clientIp(req),
      now,
    })
    if (result instanceof Error) {
      sendWidgetError(res, result)
      return
    }

    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(result))
  })

  if (deps.testControls) {
    const controls = deps.testControls

    router.on('POST', '/api/test/time', async (req, res) => {
      let raw: unknown
      try {
        raw = await readJsonBody(req)
      } catch {
        res.writeHead(400)
        res.end()
        return
      }
      const parsed = TestTimeSchema.safeParse(raw ?? {})
      if (!parsed.success) {
        res.writeHead(422, { 'content-type': 'application/json' })
        res.end(JSON.stringify(formatZodError(parsed.error)))
        return
      }
      const ms =
        parsed.data.ms ?? (parsed.data.iso != null ? Date.parse(parsed.data.iso) : Number.NaN)
      if (Number.isNaN(ms)) {
        res.writeHead(422, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ errors: [{ path: [], message: 'iso or ms required' }] }))
        return
      }
      controls.setNow(ms)
      res.writeHead(204)
      res.end()
    })

    router.on('POST', '/api/test/reset', async (_req, res) => {
      await controls.reset()
      res.writeHead(204)
      res.end()
    })

    router.on('POST', '/api/test/seed-invite', async (req, res) => {
      let raw: unknown
      try {
        raw = await readJsonBody(req)
      } catch {
        res.writeHead(400)
        res.end()
        return
      }
      const parsed = SeedInviteBodySchema.safeParse(raw ?? {})
      if (!parsed.success) {
        res.writeHead(422, { 'content-type': 'application/json' })
        res.end(JSON.stringify(formatZodError(parsed.error)))
        return
      }
      const { ttlMs = 3_600_000, maxUses, label } = parsed.data
      const { token } = await createInvite(ops, now, {
        ttlMs,
        ...(maxUses !== undefined ? { maxUses } : {}),
        ...(label !== undefined ? { label } : {}),
      })
      const appUrl = process.env.PUBLIC_APP_URL ?? 'http://localhost:5173'
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ token, activateUrl: `${appUrl}/activate?token=${token}` }))
    })
  }

  const server = createServer((req, res) => {
    Promise.resolve(router.lookup(req, res)).catch(() => {
      if (!res.writableEnded) {
        res.writeHead(500)
        res.end()
      }
    })
  })

  const close = async (): Promise<void> => {
    unsubscribe()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  return { server, close }
}
