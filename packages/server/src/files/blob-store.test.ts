import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { makeBlobStoreFromEnv, makeDeferredBlobStore, type BlobStore } from './blob-store'
import { FileStoreError, FileUnavailableError } from './errors'
import { makeFsBlobStore } from './fs-blob-store'
import { makeMemoryBlobStore } from './memory-blob-store'
import { makeS3BlobStore } from './s3-blob-store'

const ID = 'AbCdEfGhIjKlMnOpQrStUv'
const OTHER = 'ZyXwVuTsRqPoNmLkJiHgFe'
const bytes = Uint8Array.from([1, 2, 3, 250])

const tempDirs: string[] = []
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'myboard-files-'))
  tempDirs.push(dir)
  return dir
}

describe.each([
  ['memory', async () => makeMemoryBlobStore() as BlobStore],
  ['fs', async () => makeFsBlobStore(path.join(await tempDir(), 'nested'))],
])('%s blob store', (_name, make) => {
  it('round-trips bytes and type', async () => {
    const store = await make()
    expect(await store.put(ID, bytes, 'application/pdf')).toBeUndefined()
    expect(await store.get(ID)).toEqual({ bytes, mime: 'application/pdf' })
  })

  it('answers null for a missing blob and for an id that is not a blob id', async () => {
    const store = await make()
    expect(await store.get(OTHER)).toBeNull()
    expect(await store.get('../../etc/passwd')).toBeNull()
  })

  it('deletes, and deleting a missing blob is fine', async () => {
    const store = await make()
    await store.put(ID, bytes, 'image/png')
    expect(await store.delete(ID)).toBeUndefined()
    expect(await store.get(ID)).toBeNull()
    expect(await store.delete(OTHER)).toBeUndefined()
  })

  it('refuses to write or delete an unsafe id', async () => {
    const store = await make()
    expect(await store.put('../escape', bytes, 'image/png')).toBeInstanceOf(FileStoreError)
    expect(await store.delete('../escape')).toBeInstanceOf(FileStoreError)
  })

  it('keeps blobs apart', async () => {
    const store = await make()
    await store.put(ID, bytes, 'image/png')
    await store.put(OTHER, Uint8Array.from([9]), 'text/plain')
    expect((await store.get(ID)) as { mime: string }).toMatchObject({ mime: 'image/png' })
    expect(await store.get(OTHER)).toEqual({ bytes: Uint8Array.from([9]), mime: 'text/plain' })
  })
})

describe('fs blob store layout', () => {
  it('writes <blobId> and <blobId>.mime under its directory', async () => {
    const dir = await tempDir()
    await makeFsBlobStore(dir).put(ID, bytes, 'image/webp')
    expect((await fs.readdir(dir)).toSorted()).toEqual([ID, `${ID}.mime`])
  })
})

type Captured = { method: string; url: string; headers: Headers; body: Uint8Array }

function fakeS3(respond: (req: Captured) => Response = () => new Response(null, { status: 200 })) {
  const requests: Captured[] = []
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init)
    const captured = {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: new Uint8Array(await req.arrayBuffer()),
    }
    requests.push(captured)
    return respond(captured)
  }) as typeof globalThis.fetch
  return { fetch, requests }
}

const credentials = { accessKeyId: 'GKtestkey', secretAccessKey: 'secret' }

describe('s3 blob store', () => {
  it('signs a path-style PUT for region garage', async () => {
    const s3 = fakeS3()
    const store = makeS3BlobStore({
      endpoint: 'http://garage:3900/',
      bucket: 'files',
      credentials,
      fetch: s3.fetch,
    })
    expect(await store.put(ID, bytes, 'image/png')).toBeUndefined()
    const [req] = s3.requests
    expect(req?.method).toBe('PUT')
    expect(req?.url).toBe(`http://garage:3900/files/${ID}`)
    expect(req?.headers.get('content-type')).toBe('image/png')
    expect(req?.body).toEqual(bytes)
    const auth = req?.headers.get('authorization') ?? ''
    expect(auth).toMatch(/^AWS4-HMAC-SHA256 Credential=GKtestkey\/\d{8}\/garage\/s3\/aws4_request/)
    expect(req?.headers.get('x-amz-content-sha256')).toBeTruthy()
  })

  it('reads an object back, and a 404 is null', async () => {
    const s3 = fakeS3((req) =>
      req.url.endsWith(ID)
        ? new Response(bytes, { status: 200, headers: { 'content-type': 'image/png' } })
        : new Response(null, { status: 404 }),
    )
    const store = makeS3BlobStore({
      endpoint: 'http://garage:3900',
      bucket: 'files',
      credentials,
      fetch: s3.fetch,
    })
    expect(await store.get(ID)).toEqual({ bytes, mime: 'image/png' })
    expect(await store.get(OTHER)).toBeNull()
    expect(s3.requests.map((r) => r.method)).toEqual(['GET', 'GET'])
  })

  it('deletes, treating 204 and 404 alike', async () => {
    const statuses = [204, 404]
    const s3 = fakeS3(() => new Response(null, { status: statuses.shift() ?? 500 }))
    const store = makeS3BlobStore({
      endpoint: 'http://garage:3900',
      bucket: 'files',
      credentials,
      fetch: s3.fetch,
    })
    expect(await store.delete(ID)).toBeUndefined()
    expect(await store.delete(ID)).toBeUndefined()
    expect(s3.requests[0]?.method).toBe('DELETE')
  })

  it('turns an error status or a network failure into FileStoreError', async () => {
    const failing = makeS3BlobStore({
      endpoint: 'http://garage:3900',
      bucket: 'files',
      credentials,
      fetch: fakeS3(() => new Response('nope', { status: 403 })).fetch,
    })
    expect(await failing.put(ID, bytes, 'image/png')).toBeInstanceOf(FileStoreError)
    expect(await failing.get(ID)).toBeInstanceOf(FileStoreError)

    const down = makeS3BlobStore({
      endpoint: 'http://garage:3900',
      bucket: 'files',
      credentials,
      fetch: (async () => {
        throw new TypeError('fetch failed')
      }) as typeof globalThis.fetch,
    })
    const result = await down.put(ID, bytes, 'image/png')
    expect(result).toBeInstanceOf(FileStoreError)
    expect((result as FileStoreError).cause).toBeInstanceOf(TypeError)
  })
})

describe('makeBlobStoreFromEnv', () => {
  it('uses the directory store without FILES_S3_ENDPOINT', async () => {
    const dir = await tempDir()
    const store = makeBlobStoreFromEnv({ env: { FILES_FS_DIR: dir }, credentials: null })
    if (store instanceof Error) throw store
    await store.put(ID, bytes, 'image/png')
    expect(await fs.readdir(dir)).toContain(ID)
  })

  it('is unavailable with FILES_S3_ENDPOINT but no credentials yet', () => {
    const store = makeBlobStoreFromEnv({
      env: { FILES_S3_ENDPOINT: 'http://garage:3900' },
      credentials: null,
    })
    expect(store).toBeInstanceOf(FileUnavailableError)
  })

  it('builds the S3 store on bucket files once credentials exist', async () => {
    const s3 = fakeS3()
    const store = makeBlobStoreFromEnv({
      env: { FILES_S3_ENDPOINT: 'http://garage:3900' },
      credentials,
      fetch: s3.fetch,
    })
    if (store instanceof Error) throw store
    await store.put(ID, bytes, 'image/png')
    expect(s3.requests[0]?.url).toBe(`http://garage:3900/files/${ID}`)
  })
})

describe('deferred blob store', () => {
  it('answers 503 until resolved, then delegates', async () => {
    const deferred = makeDeferredBlobStore()
    expect(deferred.isReady()).toBe(false)
    const early = await deferred.put(ID, bytes, 'image/png')
    expect(early).toBeInstanceOf(FileUnavailableError)
    expect((early as FileUnavailableError).status).toBe(503)
    expect(await deferred.get(ID)).toBeInstanceOf(FileUnavailableError)

    const memory = makeMemoryBlobStore()
    deferred.resolve(memory)
    expect(deferred.isReady()).toBe(true)
    await deferred.put(ID, bytes, 'image/png')
    expect(memory.ids()).toEqual([ID])
  })
})
