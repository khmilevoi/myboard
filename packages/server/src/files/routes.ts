import type { IncomingMessage, ServerResponse } from 'node:http'

import {
  AVATAR_POLICY,
  FILE_DISPOSITION_HEADER,
  FILE_NAME_HEADER,
  FILES_URL_PREFIX,
  effectiveMaxBytes,
  fileSlotRelativeKey,
  type FilePolicy,
} from '@shared/files/contract'
import type Router from 'find-my-way'

import type { AuthDeps } from '../auth/handlers'
import type { SessionRecord } from '../auth/records'
import { isAuthResult, requireSession } from '../auth/session-guard'
import { validateScopedKey, type ScopedOwners, type ScopedStorageError } from '../storage/scoped'
import {
  resolveScopedRequest,
  type ResolvedScopedRequest,
  type RouteParams,
} from '../storage/scoped-request'
import type { ValkeyOps } from '../storage/valkey'
import { accountAvatarIO, avatarSlotName } from './account-avatar'
import { readUploadBody } from './body'
import { FileNotFoundError, FileSessionRequiredError, FileSlotUndeclaredError } from './errors'
import type { FilePolicies } from './policies'
import type { BlobRecord } from './records'
import { readStorageSlot, storageSlotIO, type FileService, type FileUpload } from './service'
import { sanitizeFileName } from './upload'

export type FileRoutesDeps = {
  router: Router.Instance<Router.HTTPVersion.V1>
  ops: ValkeyOps
  authDeps: AuthDeps
  owners: ScopedOwners
  policies: FilePolicies
  files: FileService
}

const SCOPED = '/api/files/scoped/:owner/:id/:scope/:key'
const BLOB_URI_PATTERN = /^\/files\/([^/?#]+)(?:[?#].*)?$/

type PublicError = {
  status: number
  code: string
  publicMessage: string
  publicDetails?: Record<string, string> | null
  cause?: unknown
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function sendError(res: ServerResponse, error: PublicError & Error): void {
  if (error.status >= 500) console.error(error, error.cause)
  sendJson(res, error.status, {
    error: { code: error.code, message: error.publicMessage, ...error.publicDetails },
  })
}

/**
 * The headers every read of a blob answers with — the Node fallback here, and nginx in production
 * (Batch B mirrors them). Any type may be stored, so the browser must never sniff or run it.
 */
export function blobResponseHeaders(record: BlobRecord): Record<string, string> {
  return {
    'content-type': record.mime,
    'content-disposition': record.disposition,
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
    // Never `public`: Cloudflare would cache the file at the edge and serve it past the gate.
    'cache-control': 'private, max-age=31536000, immutable',
  }
}

function blobIdFromOriginalUri(uri: string | undefined): string | null {
  const match = BLOB_URI_PATTERN.exec(uri ?? '')
  return match?.[1] ?? null
}

export function registerFileRoutes(deps: FileRoutesDeps): void {
  const { router, ops, authDeps, owners, policies, files } = deps

  async function sessionAccountId(req: IncomingMessage): Promise<string | null> {
    const session = await requireSession(authDeps, req)
    return isAuthResult(session) ? null : session.accountId
  }

  type ResolvedSlot = ResolvedScopedRequest & { key: string; fullKey: string; policy: FilePolicy }

  // Owner/scope (404/403), session for account scope (401) and the expected account (409) come
  // from the scoped storage resolution; then the key (422) and the declared policy (403).
  async function resolveSlot(
    req: IncomingMessage,
    params: RouteParams,
  ): Promise<ScopedStorageError | FileSlotUndeclaredError | ResolvedSlot> {
    const resolved = await resolveScopedRequest({ authDeps, owners, req, params })
    if (resolved instanceof Error) return resolved
    const key = validateScopedKey(params.key ?? '')
    if (key instanceof Error) return key
    const policy = policies.resolve(resolved.branch, key)
    const { owner, id, scope } = resolved.branch
    if (policy === null)
      return new FileSlotUndeclaredError({ slot: `${owner}/${id}/${scope}/${key}` })
    return { ...resolved, key, fullKey: resolved.namespace + fileSlotRelativeKey(key), policy }
  }

  // Writes always need a session, even on a shared branch: the blob's access rule and the
  // account scope both come from it.
  async function writerSession(
    req: IncomingMessage,
    slot: ResolvedSlot,
  ): Promise<SessionRecord | FileSessionRequiredError> {
    if (slot.session !== null) return slot.session
    const session = await requireSession(authDeps, req)
    return isAuthResult(session) ? new FileSessionRequiredError() : session
  }

  async function readUpload(req: IncomingMessage, policy: FilePolicy) {
    const bytes = await readUploadBody(req, effectiveMaxBytes(policy))
    if (bytes instanceof Error) return bytes
    const rawName = req.headers[FILE_NAME_HEADER]
    const upload: FileUpload = {
      bytes,
      declaredType: req.headers['content-type'],
      name: sanitizeFileName(typeof rawName === 'string' ? rawName : undefined),
    }
    return upload
  }

  router.on('GET', SCOPED, async (req, res, params) => {
    const slot = await resolveSlot(req, params)
    if (slot instanceof Error) return sendError(res, slot)
    sendJson(res, 200, { value: await readStorageSlot(ops, slot.fullKey) })
  })

  router.on('PUT', SCOPED, async (req, res, params) => {
    const slot = await resolveSlot(req, params)
    if (slot instanceof Error) return sendError(res, slot)
    const session = await writerSession(req, slot)
    if (session instanceof Error) return sendError(res, session)
    const upload = await readUpload(req, slot.policy)
    if (upload instanceof Error) return sendError(res, upload)

    const ref = await files.writeSlot({
      slot: slot.fullKey,
      access:
        slot.branch.scope === 'account'
          ? { kind: 'account', accountId: session.accountId }
          : { kind: 'members' },
      policy: slot.policy,
      upload,
      io: storageSlotIO(ops, slot.fullKey),
    })
    if (ref instanceof Error) return sendError(res, ref)
    sendJson(res, 200, { value: ref })
  })

  router.on('DELETE', SCOPED, async (req, res, params) => {
    const slot = await resolveSlot(req, params)
    if (slot instanceof Error) return sendError(res, slot)
    const session = await writerSession(req, slot)
    if (session instanceof Error) return sendError(res, session)
    const cleared = await files.clearSlot(storageSlotIO(ops, slot.fullKey))
    if (cleared instanceof Error) return sendError(res, cleared)
    res.writeHead(204)
    res.end()
  })

  router.on('PUT', '/api/files/account/avatar', async (req, res) => {
    const accountId = await sessionAccountId(req)
    if (accountId === null) return sendError(res, new FileSessionRequiredError())
    const upload = await readUpload(req, AVATAR_POLICY)
    if (upload instanceof Error) return sendError(res, upload)

    const ref = await files.writeSlot({
      slot: avatarSlotName(accountId),
      access: { kind: 'members' },
      policy: AVATAR_POLICY,
      upload,
      io: accountAvatarIO(ops, accountId),
    })
    if (ref instanceof Error) return sendError(res, ref)
    sendJson(res, 200, { value: ref })
  })

  router.on('DELETE', '/api/files/account/avatar', async (req, res) => {
    const accountId = await sessionAccountId(req)
    if (accountId === null) return sendError(res, new FileSessionRequiredError())
    const cleared = await files.clearSlot(accountAvatarIO(ops, accountId))
    if (cleared instanceof Error) return sendError(res, cleared)
    res.writeHead(204)
    res.end()
  })

  // nginx `auth_request` verifier for `/files/<blobId>`: a bodyless GET carrying X-Original-URI.
  // 204 carries the stored Content-Disposition for nginx to apply (`auth_request_set`).
  router.on('GET', '/api/files/authorize', async (req, res) => {
    const original = req.headers['x-original-uri']
    const blobId = blobIdFromOriginalUri(typeof original === 'string' ? original : undefined)
    const accountId = await sessionAccountId(req)
    if (accountId === null) return sendError(res, new FileSessionRequiredError())
    if (blobId === null) return sendError(res, new FileNotFoundError({ blobId: '' }))
    const record = await files.authorize({ blobId, accountId })
    if (record instanceof Error) return sendError(res, record)
    res.writeHead(204, { [FILE_DISPOSITION_HEADER]: record.disposition })
    res.end()
  })

  // Dev/e2e fallback for what nginx serves straight from Garage in production.
  router.on('GET', `${FILES_URL_PREFIX}:blobId`, async (req, res, params) => {
    const accountId = await sessionAccountId(req)
    const read = await files.readFile({ blobId: params.blobId ?? '', accountId })
    if (read instanceof Error) return sendError(res, read)
    res.writeHead(200, {
      ...blobResponseHeaders(read.record),
      'content-length': String(read.bytes.byteLength),
    })
    res.end(read.bytes)
  })
}
