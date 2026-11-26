import type { IncomingMessage, ServerResponse } from 'node:http'

import { isFileSlotKey } from '@shared/files/contract'
import type Router from 'find-my-way'

import type { AuthDeps } from '../auth/handlers'
import { readJsonBody } from '../http/body'
import {
  handleAppend,
  handleDelete,
  handleGet,
  handleKeys,
  handlePut,
  publishChange,
  type HandlerResult,
} from './handlers'
import { runExclusive } from './key-lock'
import { AppendPayloadSchema, PrefixQuerySchema, PutPayloadSchema, formatZodError } from './schemas'
import {
  ScopedKeyInvalidError,
  validateScopedKey,
  type ScopedOwners,
  type ScopedStorageError,
} from './scoped'
import { resolveScopedRequest, type RouteParams } from './scoped-request'
import type { ValkeyOps } from './valkey'

export type ScopedRoutesDeps = {
  router: Router.Instance<Router.HTTPVersion.V1>
  ops: ValkeyOps
  authDeps: AuthDeps
  owners: ScopedOwners
}

const BASE = '/api/storage/scoped/:owner/:id/:scope'

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function sendScopedError(res: ServerResponse, error: ScopedStorageError): void {
  sendJson(res, error.status, { error: { code: error.code, message: error.publicMessage } })
}

function sendResult(res: ServerResponse, result: HandlerResult): void {
  if (result.body === undefined) {
    res.writeHead(result.status)
    res.end()
    return
  }
  sendJson(res, result.status, result.body)
}

export function registerScopedStorageRoutes(deps: ScopedRoutesDeps): void {
  const { router, ops, authDeps, owners } = deps

  async function resolveNamespace(
    req: IncomingMessage,
    params: RouteParams,
  ): Promise<ScopedStorageError | string> {
    const resolved = await resolveScopedRequest({ authDeps, owners, req, params })
    return resolved instanceof Error ? resolved : resolved.namespace
  }

  async function resolveFullKey(
    req: IncomingMessage,
    params: RouteParams,
  ): Promise<ScopedStorageError | string> {
    const namespace = await resolveNamespace(req, params)
    if (namespace instanceof Error) return namespace
    const key = validateScopedKey(params.key ?? '')
    if (key instanceof Error) return key
    return `${namespace}${key}`
  }

  // Same 413/400 mapping as the /api/storage routes. Returns the parsed body
  // wrapped in an object, or null once the error response has been sent.
  async function readBody(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<{ raw: unknown } | null> {
    const raw = await readJsonBody(req).catch((cause: unknown) =>
      cause instanceof Error ? cause : new Error('invalid body', { cause }),
    )
    if (!(raw instanceof Error)) return { raw }
    res.writeHead(raw.message === 'request body too large' ? 413 : 400)
    res.end()
    return null
  }

  router.on('GET', BASE, async (req, res, params, _store, query) => {
    const namespace = await resolveNamespace(req, params)
    if (namespace instanceof Error) return sendScopedError(res, namespace)

    const parsed = PrefixQuerySchema.safeParse(query ?? {})
    if (!parsed.success) return sendJson(res, 422, formatZodError(parsed.error))
    const prefix = parsed.data.prefix ?? ''
    if (prefix !== '' && validateScopedKey(prefix) instanceof Error) {
      return sendScopedError(res, new ScopedKeyInvalidError())
    }

    const listing = await handleKeys(ops, `${namespace}${prefix}`)
    const { keys } = listing.body as { keys: string[] }
    // File slots (`@files/<key>`) are not values: a listing never shows them.
    const relative = keys.map((k) => k.slice(namespace.length)).filter((k) => !isFileSlotKey(k))
    sendJson(res, 200, { keys: relative })
  })

  router.on('GET', `${BASE}/:key`, async (req, res, params) => {
    const fullKey = await resolveFullKey(req, params)
    if (fullKey instanceof Error) return sendScopedError(res, fullKey)
    sendResult(res, await handleGet(ops, fullKey))
  })

  router.on('PUT', `${BASE}/:key`, async (req, res, params) => {
    const fullKey = await resolveFullKey(req, params)
    if (fullKey instanceof Error) return sendScopedError(res, fullKey)
    const body = await readBody(req, res)
    if (body === null) return
    const parsed = PutPayloadSchema.safeParse(body.raw)
    if (!parsed.success) return sendJson(res, 422, formatZodError(parsed.error))
    sendResult(res, await handlePut(ops, fullKey, parsed.data))
    await publishChange(ops, fullKey, parsed.data.value)
  })

  router.on('POST', `${BASE}/:key/append`, async (req, res, params) => {
    const fullKey = await resolveFullKey(req, params)
    if (fullKey instanceof Error) return sendScopedError(res, fullKey)
    const body = await readBody(req, res)
    if (body === null) return
    const parsed = AppendPayloadSchema.safeParse(body.raw)
    if (!parsed.success) return sendJson(res, 422, formatZodError(parsed.error))

    const status = await runExclusive(fullKey, async () => {
      const result = await handleAppend(ops, fullKey, parsed.data)
      await publishChange(ops, fullKey, result.value)
      return result.status
    })
    res.writeHead(status)
    res.end()
  })

  router.on('DELETE', `${BASE}/:key`, async (req, res, params) => {
    const fullKey = await resolveFullKey(req, params)
    if (fullKey instanceof Error) return sendScopedError(res, fullKey)
    sendResult(res, await handleDelete(ops, fullKey))
    await publishChange(ops, fullKey, null)
  })
}
