import { IMAGE_MIME_TYPES, type FilePolicy, type FileRef } from '@shared/files/contract'
import { encodePng } from 'image-codec/testing'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { makeScopedOwners } from '../storage/scoped'
import { openSse, startTestApp, type TestApp } from '../test/app-fixture'
import { PDF_BYTES, SVG_BYTES, pngBytes } from '../test/file-fixtures'
import { makeFilePolicies } from './policies'
import { blobRecordKey } from './records'

const owners = makeScopedOwners({
  widgetTypeIds: ['notes-widget'],
  moduleScopes: { cats: ['shared', 'account'], board: ['shared'] },
})

// Image types without pixel rules, so header-only fixtures are enough; the avatar route below
// carries the rules and gets real images.
const PHOTO_POLICY: FilePolicy = { accept: IMAGE_MIME_TYPES, maxBytes: 2 * 1024 * 1024 }

const policies = makeFilePolicies([
  { owner: 'module', id: 'cats', scope: 'shared', keyPattern: 'photo', policy: PHOTO_POLICY },
  {
    owner: 'module',
    id: 'cats',
    scope: 'account',
    keyPattern: /^docs\/[a-z]+$/,
    policy: { accept: ['application/pdf', 'image/*'], maxBytes: 4096 },
  },
  {
    owner: 'module',
    id: 'cats',
    scope: 'shared',
    keyPattern: 'tiny',
    policy: { accept: ['*/*'], maxBytes: 16 },
  },
  {
    owner: 'module',
    id: 'cats',
    scope: 'shared',
    keyPattern: 'any',
    policy: { accept: ['*/*'], maxBytes: 4096 },
  },
])

const shared = (key: string) => `/api/files/scoped/module/cats/shared/${encodeURIComponent(key)}`
const account = (key: string) => `/api/files/scoped/module/cats/account/${encodeURIComponent(key)}`

describe('file routes', () => {
  let app: TestApp

  beforeEach(async () => {
    app = await startTestApp({ scopedOwners: owners, filePolicies: policies })
  })
  afterEach(async () => {
    await app.close()
  })

  const upload = (
    path: string,
    bytes: Uint8Array,
    type: string,
    cookie?: string,
    extra: Record<string, string> = {},
  ) =>
    fetch(`${app.base}${path}`, {
      method: 'PUT',
      headers: {
        'content-type': type,
        'X-Requested-With': 'MyBoard',
        ...(cookie ? { cookie } : {}),
        ...extra,
      },
      body: bytes,
    })
  const remove = (path: string, cookie?: string) =>
    fetch(`${app.base}${path}`, {
      method: 'DELETE',
      headers: { 'X-Requested-With': 'MyBoard', ...(cookie ? { cookie } : {}) },
    })
  const get = (path: string, cookie?: string, extra: Record<string, string> = {}) =>
    fetch(`${app.base}${path}`, { headers: { ...(cookie ? { cookie } : {}), ...extra } })
  const authorize = (blobId: string, cookie?: string) =>
    get('/api/files/authorize', cookie, { 'x-original-uri': `/files/${blobId}` })

  it('uploads to a shared slot, reads the ref back and serves the bytes to a session', async () => {
    const a = await app.seedSession('A')
    const b = await app.seedSession('B')
    const res = await upload(shared('photo'), pngBytes(20, 10), 'image/png', a.cookie)
    expect(res.status).toBe(200)
    const { value } = (await res.json()) as { value: FileRef }
    expect(value).toMatchObject({
      mime: 'image/png',
      image: { width: 20, height: 10 },
      url: `/files/${value.blobId}`,
    })
    expect(await app.ops.get(`m:cats:s:@files/photo`)).toBe(JSON.stringify(value))

    expect(await (await get(shared('photo'))).json()).toEqual({ value })

    const file = await get(value.url, b.cookie)
    expect(file.status).toBe(200)
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(pngBytes(20, 10))
    expect(Object.fromEntries(file.headers)).toMatchObject({
      'content-type': 'image/png',
      'content-disposition': 'inline',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cache-control': 'private, max-age=31536000, immutable',
    })
    expect((await get(value.url)).status).toBe(401)
  })

  it('answers null for an empty declared slot', async () => {
    expect(await (await get(shared('photo'))).json()).toEqual({ value: null })
  })

  it('requires a session to write even a shared slot', async () => {
    const res = await upload(shared('photo'), pngBytes(1, 1), 'image/png')
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: { code: 'session_missing' } })
    expect(app.blobs.ids()).toEqual([])
  })

  it('refuses an undeclared slot with 403, and an unknown owner with 404', async () => {
    const a = await app.seedSession('A')
    const undeclared = await upload(shared('elsewhere'), pngBytes(1, 1), 'image/png', a.cookie)
    expect(undeclared.status).toBe(403)
    expect(await undeclared.json()).toMatchObject({ error: { code: 'file_slot_undeclared' } })
    expect((await get(shared('elsewhere'))).status).toBe(403)
    const unknown = await upload(
      '/api/files/scoped/module/dogs/shared/photo',
      pngBytes(1, 1),
      'image/png',
      a.cookie,
    )
    expect(unknown.status).toBe(404)
  })

  it('refuses an oversized body with 413 and a mismatched or unaccepted type with 415', async () => {
    const a = await app.seedSession('A')
    const big = await upload(shared('tiny'), new Uint8Array(64), 'text/plain', a.cookie)
    expect(big.status).toBe(413)
    expect(await big.json()).toMatchObject({ error: { code: 'file_too_large' } })

    const mismatch = await upload(shared('photo'), SVG_BYTES, 'image/png', a.cookie)
    expect(mismatch.status).toBe(415)
    expect(await mismatch.json()).toMatchObject({ error: { code: 'file_type_mismatch' } })

    const svg = await upload(shared('photo'), SVG_BYTES, 'image/svg+xml', a.cookie)
    expect(svg.status).toBe(415)
    expect(await svg.json()).toMatchObject({ error: { code: 'file_type_not_accepted' } })
    expect(app.blobs.ids()).toEqual([])
  })

  it('refuses a body larger than the limit without a usable Content-Length', async () => {
    const a = await app.seedSession('A')
    const chunk = new Uint8Array(8)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 8; i += 1) controller.enqueue(chunk)
        controller.close()
      },
    })
    const res = await fetch(`${app.base}${shared('tiny')}`, {
      method: 'PUT',
      headers: { 'content-type': 'text/plain', 'X-Requested-With': 'MyBoard', cookie: a.cookie },
      body: stream,
      duplex: 'half',
    } as RequestInit)
    expect(res.status).toBe(413)
  })

  it('stores any declared type as an attachment with its file name', async () => {
    const a = await app.seedSession('A')
    const res = await upload(shared('any'), SVG_BYTES, 'image/svg+xml', a.cookie, {
      'x-file-name': encodeURIComponent('логотип.svg'),
    })
    expect(res.status).toBe(200)
    const { value } = (await res.json()) as { value: FileRef }
    expect(value).toMatchObject({ mime: 'image/svg+xml', name: 'логотип.svg' })
    const file = await get(value.url, a.cookie)
    expect(file.headers.get('content-disposition')).toBe(
      `attachment; filename="_______.svg"; filename*=UTF-8''${encodeURIComponent('логотип.svg')}`,
    )
    expect(file.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox")
  })

  it('keeps account-scoped files to their account', async () => {
    const a = await app.seedSession('A')
    const b = await app.seedSession('B')
    const res = await upload(account('docs/tax'), PDF_BYTES, 'application/pdf', a.cookie)
    expect(res.status).toBe(200)
    const { value } = (await res.json()) as { value: FileRef }
    expect(await app.ops.get(`m:cats:a:${a.accountId}:@files/docs/tax`)).not.toBeNull()
    const record = JSON.parse((await app.ops.get(blobRecordKey(value.blobId))) as string)
    expect(record.access).toEqual({ kind: 'account', accountId: a.accountId })

    expect(await (await get(account('docs/tax'), b.cookie)).json()).toEqual({ value: null })
    expect((await get(value.url, a.cookie)).status).toBe(200)
    expect((await get(value.url, b.cookie)).status).toBe(403)
    expect((await get(account('docs/tax'))).status).toBe(401)
  })

  it('refuses with 409 when the expected-account header names another account', async () => {
    const a = await app.seedSession('A')
    const b = await app.seedSession('B')
    const res = await upload(account('docs/tax'), PDF_BYTES, 'application/pdf', b.cookie, {
      'x-myboard-expected-account': a.accountId,
    })
    expect(res.status).toBe(409)
    expect(app.blobs.ids()).toEqual([])
  })

  it('replaces and deletes, removing the old blobs', async () => {
    const a = await app.seedSession('A')
    const first = (await (
      await upload(shared('photo'), pngBytes(1, 1), 'image/png', a.cookie)
    ).json()) as {
      value: FileRef
    }
    const second = (await (
      await upload(shared('photo'), pngBytes(2, 2), 'image/png', a.cookie)
    ).json()) as {
      value: FileRef
    }
    expect(app.blobs.ids()).toEqual([second.value.blobId])
    expect((await get(first.value.url, a.cookie)).status).toBe(404)

    expect((await remove(shared('photo'))).status).toBe(401)
    expect((await remove(shared('photo'), a.cookie)).status).toBe(204)
    expect(app.blobs.ids()).toEqual([])
    expect(await (await get(shared('photo'))).json()).toEqual({ value: null })
  })

  it('authorize answers 204 with the disposition, or 401/403/404', async () => {
    const a = await app.seedSession('A')
    const b = await app.seedSession('B')
    const { value } = (await (
      await upload(account('docs/tax'), PDF_BYTES, 'application/pdf', a.cookie)
    ).json()) as { value: FileRef }

    const ok = await authorize(value.blobId, a.cookie)
    expect(ok.status).toBe(204)
    expect(ok.headers.get('x-file-disposition')).toBe('inline')
    expect((await authorize(value.blobId, b.cookie)).status).toBe(403)
    expect((await authorize(value.blobId)).status).toBe(401)
    expect((await authorize('UnknownUnknownUnknown1', a.cookie)).status).toBe(404)
    expect(
      (await get('/api/files/authorize', a.cookie, { 'x-original-uri': '/api/x' })).status,
    ).toBe(404)
    const withQuery = await get('/api/files/authorize', a.cookie, {
      'x-original-uri': `/files/${value.blobId}?v=2`,
    })
    expect(withQuery.status).toBe(204)
  })

  it('uploads and removes the account avatar, and the account routes report it', async () => {
    const a = await app.seedSession('A')
    expect((await upload('/api/files/account/avatar', pngBytes(1, 1), 'image/png')).status).toBe(
      401,
    )
    const gif = await upload(
      '/api/files/account/avatar',
      Uint8Array.from([...new TextEncoder().encode('GIF89a'), 1, 0, 1, 0, 0, 0, 0]),
      'image/gif',
      a.cookie,
    )
    expect(gif.status).toBe(415)

    const res = await upload(
      '/api/files/account/avatar',
      encodePng(256, 256),
      'image/png',
      a.cookie,
    )
    expect(res.status).toBe(200)
    const { value } = (await res.json()) as { value: FileRef }
    expect(value.image).toEqual({ width: 256, height: 256 })

    const info = (await (await get('/api/auth/account', a.cookie)).json()) as { avatarUrl?: string }
    expect(info.avatarUrl).toBe(value.url)
    const roster = (await (await get('/api/auth/accounts', a.cookie)).json()) as {
      accounts: { accountId: string; avatarUrl?: string }[]
    }
    expect(roster.accounts.find((x) => x.accountId === a.accountId)?.avatarUrl).toBe(value.url)

    const b = await app.seedSession('B')
    expect((await get(value.url, b.cookie)).status).toBe(200)

    const replaced = (await (
      await upload('/api/files/account/avatar', encodePng(8, 8), 'image/png', a.cookie)
    ).json()) as { value: FileRef }
    expect(app.blobs.ids()).toEqual([replaced.value.blobId])

    expect((await remove('/api/files/account/avatar', a.cookie)).status).toBe(204)
    expect(app.blobs.ids()).toEqual([])
    const after = (await (await get('/api/auth/account', a.cookie)).json()) as {
      avatarUrl?: string
    }
    expect(after.avatarUrl).toBeUndefined()
  })

  it('answers 422 with the broken rule for an avatar the image rules reject', async () => {
    const a = await app.seedSession('A')
    const avatar = (bytes: Uint8Array) =>
      upload('/api/files/account/avatar', bytes, 'image/png', a.cookie)

    const landscape = await avatar(encodePng(600, 400))
    expect(landscape.status).toBe(422)
    expect(await landscape.json()).toEqual({
      error: {
        code: 'file_image_rejected',
        message: 'The image does not meet the rules of this slot',
        reason: 'too_large',
      },
    })

    const oblong = await avatar(encodePng(300, 200))
    expect(oblong.status).toBe(422)
    expect(((await oblong.json()) as { error: { reason: string } }).error.reason).toBe('not_square')

    const truncated = await avatar(encodePng(64, 64).subarray(0, 60))
    expect(truncated.status).toBe(415)
    expect(((await truncated.json()) as { error: { code: string } }).error.code).toBe(
      'file_image_undecodable',
    )
    expect(app.blobs.ids()).toEqual([])
  })

  it('delivers slot changes over SSE under the @files/ relative key', async () => {
    const a = await app.seedSession('A')
    const sse = await openSse(app.base, a.cookie)
    try {
      const ref = { owner: 'module', id: 'cats', scope: 'shared', key: '@files/photo' }
      const sub = await fetch(`${app.base}/api/storage/events/${sse.connId}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Requested-With': 'MyBoard',
          cookie: a.cookie,
        },
        body: JSON.stringify({ scoped: { subscribe: [ref] } }),
      })
      expect(sub.status).toBe(204)
      const { value } = (await (
        await upload(shared('photo'), pngBytes(3, 3), 'image/png', a.cookie)
      ).json()) as { value: FileRef }
      expect(await sse.nextFrame()).toEqual({
        key: 'scoped:module/cats/shared/@files/photo',
        value,
      })
      await remove(shared('photo'), a.cookie)
      expect(await sse.nextFrame()).toEqual({
        key: 'scoped:module/cats/shared/@files/photo',
        value: null,
      })
    } finally {
      sse.close()
    }
  })
})

describe('file slots and the storage routes', () => {
  let app: TestApp

  beforeEach(async () => {
    app = await startTestApp({ scopedOwners: owners, filePolicies: policies })
  })
  afterEach(async () => {
    await app.close()
  })

  const send = (method: string, path: string, body?: unknown) =>
    fetch(`${app.base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'X-Requested-With': 'MyBoard' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })

  it('cannot write, append to or delete a slot through scoped storage', async () => {
    const path = `/api/storage/scoped/module/cats/shared/${encodeURIComponent('@files/photo')}`
    expect((await send('PUT', path, { value: { blobId: 'x' } })).status).toBe(422)
    expect((await send('POST', `${path}/append`, { entry: {} })).status).toBe(422)
    expect((await send('DELETE', path)).status).toBe(422)
    expect((await send('GET', path)).status).toBe(422)
  })

  it('cannot reach a slot-shaped key through the generic storage routes', async () => {
    const path = `/api/storage/${encodeURIComponent('w:i:abc:@files/photo')}`
    expect((await send('PUT', path, { value: 1 })).status).toBe(403)
    expect((await send('POST', `${path}/append`, { entry: {} })).status).toBe(403)
    expect((await send('DELETE', path)).status).toBe(403)
  })

  it('hides slots from the scoped key listing', async () => {
    const a = await app.seedSession('A')
    await fetch(`${app.base}${shared('photo')}`, {
      method: 'PUT',
      headers: { 'content-type': 'image/png', 'X-Requested-With': 'MyBoard', cookie: a.cookie },
      body: pngBytes(1, 1),
    })
    await send('PUT', '/api/storage/scoped/module/cats/shared/note', { value: 1 })
    const listing = await (await send('GET', '/api/storage/scoped/module/cats/shared')).json()
    expect(listing).toEqual({ keys: ['note'] })
  })

  it('refuses an SSE subscription to a malformed slot key', async () => {
    const sse = await openSse(app.base)
    try {
      const res = await send('POST', `/api/storage/events/${sse.connId}`, {
        scoped: {
          subscribe: [{ owner: 'module', id: 'cats', scope: 'shared', key: '@files/../x' }],
        },
      })
      expect(res.status).toBe(422)
    } finally {
      sse.close()
    }
  })
})
