import crypto from 'node:crypto'
import fs from 'node:fs/promises'

import * as errore from 'errore'

import { DEFAULT_FILES_BUCKET } from './blob-store'
import type { S3Credentials } from './s3-blob-store'

/**
 * Idempotent first-boot setup of the single Garage node through its Admin API v2
 * (`dxflrs/garage:v2.6.0`): every step reads the current state first and only writes what is
 * missing, so a restart, a half-finished earlier run, or an already bootstrapped cluster all end
 * in the same place. Nothing is stored: the S3 key is derived from the admin token.
 */

/** Zone of the one node. Irrelevant with a single node, but Garage requires one. */
export const GARAGE_ZONE = 'pi'

/**
 * The node's declared capacity, in bytes. Garage uses capacities only to spread partitions
 * between nodes — it is not a quota, so with one node any positive value works. 100 GB states
 * the intent (a Pi's SD card or USB disk) without pretending to measure it.
 */
export const GARAGE_NODE_CAPACITY_BYTES = 100_000_000_000

/** Garage refuses website access without an index document; nothing is ever served from it. */
const WEBSITE_INDEX_DOCUMENT = 'index.html'

const KEY_NAME = 'myboard-files'

export class GarageAdminUnreachableError extends errore.createTaggedError({
  name: 'GarageAdminUnreachableError',
  message: 'Garage admin API is unreachable for $operation',
}) {}

export class GarageAdminError extends errore.createTaggedError({
  name: 'GarageAdminError',
  message: 'Garage admin $operation answered $status',
}) {}

export class GarageNoNodeError extends errore.createTaggedError({
  name: 'GarageNoNodeError',
  message: 'Garage reports no node to assign a layout role to',
}) {}

export class GarageBootstrapConfigError extends errore.createTaggedError({
  name: 'GarageBootstrapConfigError',
  message: 'FILES_S3_ENDPOINT is set, but $variable is missing',
}) {}

export class GarageTokenReadError extends errore.createTaggedError({
  name: 'GarageTokenReadError',
  message: 'Could not read the Garage admin token from $file',
}) {}

export type GarageBootstrapError =
  | GarageAdminUnreachableError
  | GarageAdminError
  | GarageNoNodeError

/**
 * The S3 key the server uses, derived from the admin token so the bootstrap is repeatable and
 * nothing has to be persisted. Garage requires an imported key id of `GK` + 12 bytes in hex and a
 * secret of 32 bytes in hex.
 */
export function deriveFilesCredentials(adminToken: string): S3Credentials {
  const hmac = (label: string) =>
    crypto.createHmac('sha256', adminToken).update(label).digest('hex')
  return {
    accessKeyId: `GK${hmac('myboard-files-id').slice(0, 24)}`,
    secretAccessKey: hmac('myboard-files-secret'),
  }
}

type ClusterStatus = {
  layoutVersion: number
  nodes: Array<{ id: string; isUp: boolean; role?: { zone: string } | null }>
}
type ClusterLayout = { version: number }
type BucketInfo = {
  id: string
  websiteAccess: boolean
  keys: Array<{ accessKeyId: string; permissions: { read?: boolean; write?: boolean } }>
}
type KeyInfo = { accessKeyId: string }

function makeAdminClient(options: {
  adminUrl: string
  adminToken: string
  fetch: typeof globalThis.fetch
}) {
  const base = options.adminUrl.replace(/\/+$/, '')

  /** One admin call. 404 is `null` (a missing bucket or key); any other non-2xx is an error. */
  async function call<T = Record<string, unknown>>(
    operation: string,
    init: { query?: Record<string, string>; body?: unknown } = {},
  ): Promise<T | null | GarageBootstrapError> {
    const query = init.query ? `?${new URLSearchParams(init.query).toString()}` : ''
    const res = await options
      .fetch(`${base}/v2/${operation}${query}`, {
        method: init.body === undefined ? 'GET' : 'POST',
        headers: {
          authorization: `Bearer ${options.adminToken}`,
          ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      })
      .catch((cause) => new GarageAdminUnreachableError({ operation, cause }))
    if (res instanceof Error) return res
    if (res.status === 404) return null
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return new GarageAdminError({
        operation,
        status: String(res.status),
        cause: new Error(detail.slice(0, 500)),
      })
    }
    return (res.json() as Promise<T>).catch(
      (cause) => new GarageAdminError({ operation, status: 'an unreadable body', cause }),
    )
  }

  /** Like `call`, for endpoints where a 404 is not an answer but a failure. */
  async function expect<T = Record<string, unknown>>(
    operation: string,
    init: { query?: Record<string, string>; body?: unknown } = {},
  ) {
    const result = await call<T>(operation, init)
    if (result === null) return new GarageAdminError({ operation, status: '404' })
    return result
  }

  return { call, expect }
}

type AdminClient = ReturnType<typeof makeAdminClient>

/** The node has a role in the applied layout; stage it and apply `version + 1` if not. */
async function ensureLayout(admin: AdminClient) {
  const status = await admin.expect<ClusterStatus>('GetClusterStatus')
  if (status instanceof Error) return status
  const node = status.nodes.find((n) => n.isUp) ?? status.nodes[0]
  if (node === undefined) return new GarageNoNodeError()
  if (node.role) return

  const layout = await admin.expect<ClusterLayout>('GetClusterLayout')
  if (layout instanceof Error) return layout
  // Re-staging an already staged role is harmless, so a run that died between the two calls
  // simply stages it again.
  const staged = await admin.expect('UpdateClusterLayout', {
    body: {
      roles: [{ id: node.id, zone: GARAGE_ZONE, capacity: GARAGE_NODE_CAPACITY_BYTES, tags: [] }],
    },
  })
  if (staged instanceof Error) return staged
  const applied = await admin.expect('ApplyClusterLayout', {
    body: { version: layout.version + 1 },
  })
  if (applied instanceof Error) return applied
}

/** The bucket with this global alias exists and has website access (nginx reads through it). */
async function ensureBucket(admin: AdminClient, bucket: string) {
  const found = await admin.call<BucketInfo>('GetBucketInfo', { query: { globalAlias: bucket } })
  if (found instanceof Error) return found
  const info =
    found ?? (await admin.expect<BucketInfo>('CreateBucket', { body: { globalAlias: bucket } }))
  if (info instanceof Error) return info
  if (info.websiteAccess) return info

  const updated = await admin.expect<BucketInfo>('UpdateBucket', {
    query: { id: info.id },
    body: { websiteAccess: { enabled: true, indexDocument: WEBSITE_INDEX_DOCUMENT } },
  })
  if (updated instanceof Error) return updated
  return info
}

/** The derived key is imported and may read and write the bucket. */
async function ensureKey(admin: AdminClient, bucket: BucketInfo, credentials: S3Credentials) {
  const { accessKeyId, secretAccessKey } = credentials
  const key = await admin.call<KeyInfo>('GetKeyInfo', { query: { id: accessKeyId } })
  if (key instanceof Error) return key
  if (key === null) {
    const imported = await admin.expect('ImportKey', {
      body: { accessKeyId, secretAccessKey, name: KEY_NAME },
    })
    if (imported instanceof Error) return imported
  }

  const grant = bucket.keys.find((k) => k.accessKeyId === accessKeyId)
  if (grant?.permissions.read && grant.permissions.write) return
  // AllowBucketKey only ever turns flags on; `owner` stays off — the server never needs it.
  const allowed = await admin.expect('AllowBucketKey', {
    body: { bucketId: bucket.id, accessKeyId, permissions: { read: true, write: true } },
  })
  if (allowed instanceof Error) return allowed
}

/**
 * Brings the cluster to: node role applied, bucket `bucket` with website access, the derived key
 * imported with read+write on it. Returns the key to build the S3 store with.
 */
export async function bootstrapGarage(options: {
  adminUrl: string
  adminToken: string
  bucket: string
  fetch?: typeof globalThis.fetch
}): Promise<S3Credentials | GarageBootstrapError> {
  const admin = makeAdminClient({
    adminUrl: options.adminUrl,
    adminToken: options.adminToken,
    fetch: options.fetch ?? globalThis.fetch,
  })
  const credentials = deriveFilesCredentials(options.adminToken)

  const layout = await ensureLayout(admin)
  if (layout instanceof Error) return layout

  const bucket = await ensureBucket(admin, options.bucket)
  if (bucket instanceof Error) return bucket

  const key = await ensureKey(admin, bucket, credentials)
  if (key instanceof Error) return key

  return credentials
}

export type GarageBootstrapConfig = { adminUrl: string; adminTokenFile: string; bucket: string }

export type GarageBootstrapEnv = Partial<
  Record<'FILES_GARAGE_ADMIN_URL' | 'FILES_GARAGE_ADMIN_TOKEN_FILE' | 'FILES_S3_BUCKET', string>
>

export function loadGarageBootstrapConfig(
  env: GarageBootstrapEnv,
): GarageBootstrapConfig | GarageBootstrapConfigError {
  const adminUrl = env.FILES_GARAGE_ADMIN_URL ?? ''
  if (adminUrl === '') return new GarageBootstrapConfigError({ variable: 'FILES_GARAGE_ADMIN_URL' })
  const adminTokenFile = env.FILES_GARAGE_ADMIN_TOKEN_FILE ?? ''
  if (adminTokenFile === '') {
    return new GarageBootstrapConfigError({ variable: 'FILES_GARAGE_ADMIN_TOKEN_FILE' })
  }
  return { adminUrl, adminTokenFile, bucket: env.FILES_S3_BUCKET || DEFAULT_FILES_BUCKET }
}

/** Waits after the first, second and third failure; every later retry waits the steady delay. */
export const GARAGE_BOOTSTRAP_DELAYS_MS = [1000, 5000, 15_000] as const
export const GARAGE_BOOTSTRAP_STEADY_DELAY_MS = 60_000

type Schedule = (fn: () => void, ms: number) => () => void

const scheduleWithTimer: Schedule = (fn, ms) => {
  const timer = setTimeout(fn, ms)
  // A pending retry must never be what keeps the process alive.
  timer.unref()
  return () => clearTimeout(timer)
}

async function readTokenFile(file: string) {
  const raw = await fs
    .readFile(file, 'utf8')
    .catch((cause) => new GarageTokenReadError({ file, cause }))
  if (raw instanceof Error) return raw
  return raw.trim()
}

/**
 * Runs `bootstrapGarage` until it succeeds — at once, then after 1s, 5s, 15s and every 60s —
 * and hands the credentials to `onReady` exactly once. Garage may still be starting when the
 * server boots, and the rest of the server works meanwhile (file routes answer 503).
 */
export function startGarageBootstrap(options: {
  config: GarageBootstrapConfig
  onReady: (credentials: S3Credentials) => void
  readToken?: (file: string) => Promise<string | Error>
  fetch?: typeof globalThis.fetch
  schedule?: Schedule
  log?: (message: string) => void
}) {
  const { config, onReady } = options
  const readToken = options.readToken ?? readTokenFile
  const schedule = options.schedule ?? scheduleWithTimer
  const log = options.log ?? ((message: string) => console.warn(message))
  let failures = 0
  let cancel: (() => void) | null = null
  let stopped = false

  async function attempt() {
    cancel = null
    if (stopped) return
    const token = await readToken(config.adminTokenFile)
    const result =
      token instanceof Error
        ? token
        : await bootstrapGarage({
            adminUrl: config.adminUrl,
            adminToken: token,
            bucket: config.bucket,
            ...(options.fetch ? { fetch: options.fetch } : {}),
          })
    if (stopped) return
    if (result instanceof Error) {
      const delay = GARAGE_BOOTSTRAP_DELAYS_MS[failures] ?? GARAGE_BOOTSTRAP_STEADY_DELAY_MS
      failures += 1
      const cause = result.cause instanceof Error ? ` (${result.cause.message})` : ''
      log(
        `garage bootstrap failed (attempt ${failures}), retrying in ${delay}ms: ${result.message}${cause}`,
      )
      cancel = schedule(() => void attempt(), delay)
      return
    }
    onReady(result)
  }

  void attempt()
  return {
    stop() {
      stopped = true
      cancel?.()
      cancel = null
    },
  }
}
