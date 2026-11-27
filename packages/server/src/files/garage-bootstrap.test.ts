import { describe, expect, it } from 'vitest'

import {
  bootstrapGarage,
  deriveFilesCredentials,
  GarageAdminError,
  GarageAdminUnreachableError,
  GARAGE_BOOTSTRAP_DELAYS_MS,
  GARAGE_BOOTSTRAP_STEADY_DELAY_MS,
  loadGarageBootstrapConfig,
  startGarageBootstrap,
} from './garage-bootstrap'

const TOKEN = 'admin-token-for-tests'
const ADMIN_URL = 'http://garage:3903'
const NODE_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'

type Role = { zone: string; capacity: number | null; tags: string[] }
type Perm = { read?: boolean; write?: boolean; owner?: boolean }
type Bucket = { id: string; alias: string; websiteAccess: boolean; keys: Map<string, Perm> }

/**
 * A small model of the Garage Admin API v2 — only the endpoints the bootstrap uses, with the
 * status codes Garage answers: 404 for a missing bucket or key, 401 for a wrong token.
 */
function makeFakeGarage() {
  const state = {
    down: false,
    layoutVersion: 0,
    role: null as Role | null,
    staged: null as Role | null,
    buckets: [] as Bucket[],
    keys: new Map<string, { secret: string; name: string }>(),
  }
  const calls: string[] = []

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const bucketInfo = (b: Bucket) => ({
    id: b.id,
    globalAliases: [b.alias],
    websiteAccess: b.websiteAccess,
    keys: [...b.keys].map(([accessKeyId, permissions]) => ({
      accessKeyId,
      name: state.keys.get(accessKeyId)?.name ?? '',
      permissions,
      bucketLocalAliases: [],
    })),
  })

  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (state.down) throw new TypeError('fetch failed')
    const req = new Request(input, init)
    const url = new URL(req.url)
    calls.push(`${req.method} ${url.pathname}${url.search}`)
    if (req.headers.get('authorization') !== `Bearer ${TOKEN}`) {
      return json({ code: 'AccessDenied', message: 'Forbidden' }, 401)
    }
    const body = req.method === 'POST' ? ((await req.json()) as Record<string, unknown>) : {}
    const query = url.searchParams

    switch (`${req.method} ${url.pathname}`) {
      case 'GET /v2/GetClusterStatus':
        return json({
          layoutVersion: state.layoutVersion,
          nodes: [{ id: NODE_ID, isUp: true, draining: false, role: state.role }],
        })
      case 'GET /v2/GetClusterLayout':
        return json({
          version: state.layoutVersion,
          roles: state.role ? [{ id: NODE_ID, ...state.role }] : [],
          parameters: { zoneRedundancy: 'maximum' },
          partitionSize: 0,
          stagedRoleChanges: state.staged ? [{ id: NODE_ID, ...state.staged }] : [],
        })
      case 'POST /v2/UpdateClusterLayout': {
        const [change] = body['roles'] as Array<Role & { id: string }>
        if (change?.id !== NODE_ID) return json({ code: 'InvalidRequest' }, 400)
        state.staged = { zone: change.zone, capacity: change.capacity, tags: change.tags }
        return json({ version: state.layoutVersion })
      }
      case 'POST /v2/ApplyClusterLayout': {
        if (body['version'] !== state.layoutVersion + 1 || state.staged === null) {
          return json({ code: 'InvalidRequest' }, 400)
        }
        state.layoutVersion += 1
        state.role = state.staged
        state.staged = null
        return json({ message: ['ok'], layout: {} })
      }
      case 'GET /v2/GetBucketInfo': {
        const bucket = state.buckets.find((b) => b.alias === query.get('globalAlias'))
        return bucket ? json(bucketInfo(bucket)) : json({ code: 'NoSuchBucket' }, 404)
      }
      case 'POST /v2/CreateBucket': {
        if (state.role === null) return json({ code: 'InternalError' }, 500)
        const bucket: Bucket = {
          id: `bucket-${state.buckets.length + 1}`,
          alias: body['globalAlias'] as string,
          websiteAccess: false,
          keys: new Map(),
        }
        state.buckets.push(bucket)
        return json(bucketInfo(bucket))
      }
      case 'POST /v2/UpdateBucket': {
        const bucket = state.buckets.find((b) => b.id === query.get('id'))
        if (!bucket) return json({ code: 'NoSuchBucket' }, 404)
        const website = body['websiteAccess'] as { enabled: boolean; indexDocument?: string }
        if (website.enabled && !website.indexDocument) return json({ code: 'InvalidRequest' }, 400)
        bucket.websiteAccess = website.enabled
        return json(bucketInfo(bucket))
      }
      case 'GET /v2/GetKeyInfo': {
        const id = query.get('id') ?? ''
        const key = state.keys.get(id)
        return key
          ? json({ accessKeyId: id, name: key.name, expired: false, buckets: [] })
          : json({ code: 'NoSuchAccessKey' }, 404)
      }
      case 'POST /v2/ImportKey': {
        const id = body['accessKeyId'] as string
        const secret = body['secretAccessKey'] as string
        if (!/^GK[0-9a-f]{24}$/.test(id) || !/^[0-9a-f]{64}$/.test(secret)) {
          return json({ code: 'InvalidRequest' }, 400)
        }
        if (state.keys.has(id)) return json({ code: 'KeyAlreadyExists' }, 409)
        state.keys.set(id, { secret, name: (body['name'] as string) ?? '' })
        return json({ accessKeyId: id, name: body['name'], expired: false, buckets: [] })
      }
      case 'POST /v2/AllowBucketKey': {
        const bucket = state.buckets.find((b) => b.id === body['bucketId'])
        const id = body['accessKeyId'] as string
        if (!bucket || !state.keys.has(id)) return json({ code: 'NoSuchBucket' }, 404)
        const perms = body['permissions'] as Perm
        const current = bucket.keys.get(id) ?? {}
        bucket.keys.set(id, {
          read: current.read || perms.read,
          write: current.write || perms.write,
          owner: current.owner || perms.owner,
        })
        return json(bucketInfo(bucket))
      }
      default:
        return json({ code: 'NotFound' }, 404)
    }
  }) as typeof globalThis.fetch

  return { state, calls, fetch }
}

const run = (garage: ReturnType<typeof makeFakeGarage>, adminToken = TOKEN) =>
  bootstrapGarage({ adminUrl: ADMIN_URL, adminToken, bucket: 'files', fetch: garage.fetch })

describe('deriveFilesCredentials', () => {
  it('derives a Garage-shaped key id and secret from the admin token, deterministically', () => {
    const credentials = deriveFilesCredentials(TOKEN)
    expect(credentials.accessKeyId).toMatch(/^GK[0-9a-f]{24}$/)
    expect(credentials.secretAccessKey).toMatch(/^[0-9a-f]{64}$/)
    expect(deriveFilesCredentials(TOKEN)).toEqual(credentials)
    expect(deriveFilesCredentials('another-token').accessKeyId).not.toBe(credentials.accessKeyId)
  })
})

describe('bootstrapGarage', () => {
  it('sets up a fresh cluster: layout, bucket with website access, imported key with read+write', async () => {
    const garage = makeFakeGarage()
    const credentials = await run(garage)

    expect(credentials).toEqual(deriveFilesCredentials(TOKEN))
    const { state } = garage
    expect(state.layoutVersion).toBe(1)
    expect(state.role).toMatchObject({ zone: 'pi', tags: [] })
    expect(state.role?.capacity).toBeGreaterThan(0)
    expect(state.buckets).toHaveLength(1)
    const [bucket] = state.buckets
    expect(bucket).toMatchObject({ alias: 'files', websiteAccess: true })
    const { accessKeyId, secretAccessKey } = deriveFilesCredentials(TOKEN)
    expect(state.keys.get(accessKeyId)?.secret).toBe(secretAccessKey)
    expect(bucket?.keys.get(accessKeyId)).toMatchObject({ read: true, write: true })
    expect(bucket?.keys.get(accessKeyId)?.owner).toBeFalsy()
  })

  it('changes nothing on a cluster that is already bootstrapped', async () => {
    const garage = makeFakeGarage()
    expect(await run(garage)).not.toBeInstanceOf(Error)
    garage.calls.length = 0

    expect(await run(garage)).toEqual(deriveFilesCredentials(TOKEN))
    expect(garage.calls.filter((call) => call.startsWith('POST'))).toEqual([])
    expect(garage.state.layoutVersion).toBe(1)
    expect(garage.state.buckets).toHaveLength(1)
  })

  it('finishes a partial bootstrap: bucket without website access, key without bucket access', async () => {
    const garage = makeFakeGarage()
    const { accessKeyId, secretAccessKey } = deriveFilesCredentials(TOKEN)
    garage.state.layoutVersion = 1
    garage.state.role = { zone: 'pi', capacity: 1, tags: [] }
    garage.state.buckets.push({ id: 'b1', alias: 'files', websiteAccess: false, keys: new Map() })
    garage.state.keys.set(accessKeyId, { secret: secretAccessKey, name: 'myboard-files' })

    expect(await run(garage)).toEqual({ accessKeyId, secretAccessKey })
    expect(garage.calls).not.toContain('POST /v2/ApplyClusterLayout')
    expect(garage.calls).not.toContain('POST /v2/CreateBucket')
    expect(garage.calls).not.toContain('POST /v2/ImportKey')
    expect(garage.state.buckets[0]).toMatchObject({ websiteAccess: true })
    expect(garage.state.buckets[0]?.keys.get(accessKeyId)).toMatchObject({
      read: true,
      write: true,
    })
  })

  it('applies a staged layout as version + 1', async () => {
    const garage = makeFakeGarage()
    garage.state.layoutVersion = 3
    garage.state.staged = { zone: 'elsewhere', capacity: 5, tags: [] }

    expect(await run(garage)).not.toBeInstanceOf(Error)
    expect(garage.state.layoutVersion).toBe(4)
    expect(garage.state.role).toMatchObject({ zone: 'pi' })
  })

  it('answers GarageAdminUnreachableError when the admin API is down', async () => {
    const garage = makeFakeGarage()
    garage.state.down = true
    expect(await run(garage)).toBeInstanceOf(GarageAdminUnreachableError)
  })

  it('answers GarageAdminError with the status for a rejected token', async () => {
    const garage = makeFakeGarage()
    const result = await run(garage, 'wrong-token')
    expect(result).toBeInstanceOf(GarageAdminError)
    expect((result as GarageAdminError).status).toBe('401')
  })
})

describe('loadGarageBootstrapConfig', () => {
  it('reads the admin URL and token file', () => {
    expect(
      loadGarageBootstrapConfig({
        FILES_GARAGE_ADMIN_URL: ADMIN_URL,
        FILES_GARAGE_ADMIN_TOKEN_FILE: '/run/garage/admin_token',
      }),
    ).toEqual({
      adminUrl: ADMIN_URL,
      adminTokenFile: '/run/garage/admin_token',
      bucket: 'files',
    })
  })

  it('takes the bucket from FILES_S3_BUCKET', () => {
    expect(
      loadGarageBootstrapConfig({
        FILES_GARAGE_ADMIN_URL: ADMIN_URL,
        FILES_GARAGE_ADMIN_TOKEN_FILE: '/t',
        FILES_S3_BUCKET: 'other',
      }),
    ).toMatchObject({ bucket: 'other' })
  })

  it('is an error when either variable is missing', () => {
    expect(loadGarageBootstrapConfig({ FILES_GARAGE_ADMIN_URL: ADMIN_URL })).toBeInstanceOf(Error)
    expect(loadGarageBootstrapConfig({ FILES_GARAGE_ADMIN_TOKEN_FILE: '/t' })).toBeInstanceOf(Error)
  })
})

describe('startGarageBootstrap', () => {
  function makeScheduler() {
    const delays: number[] = []
    let pending: (() => void) | null = null
    return {
      delays,
      schedule: (fn: () => void, ms: number) => {
        delays.push(ms)
        pending = fn
        return () => {
          pending = null
        }
      },
      fire: async () => {
        const fn = pending
        pending = null
        fn?.()
        await new Promise((resolve) => setImmediate(resolve))
      },
      hasPending: () => pending !== null,
    }
  }

  it('retries with 1s, 5s, 15s and then every 60s until the bootstrap succeeds', async () => {
    const garage = makeFakeGarage()
    garage.state.down = true
    const scheduler = makeScheduler()
    const ready: unknown[] = []

    startGarageBootstrap({
      config: { adminUrl: ADMIN_URL, adminTokenFile: '/t', bucket: 'files' },
      readToken: async () => TOKEN,
      fetch: garage.fetch,
      schedule: scheduler.schedule,
      onReady: (credentials) => ready.push(credentials),
      log: () => {},
    })
    await new Promise((resolve) => setImmediate(resolve))
    for (let i = 0; i < 4; i += 1) await scheduler.fire()

    expect(scheduler.delays).toEqual([
      ...GARAGE_BOOTSTRAP_DELAYS_MS,
      GARAGE_BOOTSTRAP_STEADY_DELAY_MS,
      GARAGE_BOOTSTRAP_STEADY_DELAY_MS,
    ])
    expect(GARAGE_BOOTSTRAP_DELAYS_MS).toEqual([1000, 5000, 15000])
    expect(GARAGE_BOOTSTRAP_STEADY_DELAY_MS).toBe(60_000)
    expect(ready).toEqual([])

    garage.state.down = false
    await scheduler.fire()
    expect(ready).toEqual([deriveFilesCredentials(TOKEN)])
    expect(scheduler.hasPending()).toBe(false)
  })

  it('retries when the token file cannot be read yet', async () => {
    const garage = makeFakeGarage()
    const scheduler = makeScheduler()
    const ready: unknown[] = []
    let tokenAvailable = false

    startGarageBootstrap({
      config: { adminUrl: ADMIN_URL, adminTokenFile: '/t', bucket: 'files' },
      readToken: async () => (tokenAvailable ? TOKEN : new Error('ENOENT')),
      fetch: garage.fetch,
      schedule: scheduler.schedule,
      onReady: (credentials) => ready.push(credentials),
      log: () => {},
    })
    await new Promise((resolve) => setImmediate(resolve))
    expect(ready).toEqual([])
    expect(scheduler.delays).toEqual([1000])

    tokenAvailable = true
    await scheduler.fire()
    expect(ready).toEqual([deriveFilesCredentials(TOKEN)])
  })

  it('stops retrying once stopped', async () => {
    const garage = makeFakeGarage()
    garage.state.down = true
    const scheduler = makeScheduler()
    const handle = startGarageBootstrap({
      config: { adminUrl: ADMIN_URL, adminTokenFile: '/t', bucket: 'files' },
      readToken: async () => TOKEN,
      fetch: garage.fetch,
      schedule: scheduler.schedule,
      onReady: () => {},
      log: () => {},
    })
    await new Promise((resolve) => setImmediate(resolve))
    handle.stop()
    expect(scheduler.hasPending()).toBe(false)
  })
})
