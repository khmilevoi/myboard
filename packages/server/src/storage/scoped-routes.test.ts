import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { startTestApp, type TestApp } from '../test/app-fixture'
import { makeScopedOwners } from './scoped'

const owners = makeScopedOwners({
  widgetTypeIds: ['notes-widget'],
  moduleScopes: { notes: ['shared', 'account'], board: ['shared'] },
})

const acct = (key: string) =>
  `/api/storage/scoped/widget/notes-widget/account/${encodeURIComponent(key)}`
const ACCT_LIST = '/api/storage/scoped/widget/notes-widget/account'

describe('scoped storage routes', () => {
  let app: TestApp

  beforeEach(async () => {
    app = await startTestApp({ scopedOwners: owners })
  })
  afterEach(async () => {
    await app.close()
  })

  const get = (path: string, cookie?: string) =>
    fetch(`${app.base}${path}`, { headers: cookie ? { cookie } : {} })
  const getJson = async (path: string, cookie?: string) => (await get(path, cookie)).json()
  const send = (method: string, path: string, body: unknown, cookie?: string) =>
    fetch(`${app.base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'X-Requested-With': 'MyBoard',
        ...(cookie ? { cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const put = (path: string, value: unknown, cookie?: string) =>
    send('PUT', path, { value }, cookie)
  const append = (path: string, entry: unknown, cookie?: string) =>
    send('POST', `${path}/append`, { entry }, cookie)

  it('keeps two accounts apart for get, put, append and listing', async () => {
    const a = await app.seedSession('A')
    const b = await app.seedSession('B')
    expect((await put(acct('draft'), { v: 'a' }, a.cookie)).status).toBe(204)
    expect(await getJson(acct('draft'), a.cookie)).toEqual({ value: { v: 'a' } })
    expect((await get(acct('draft'), b.cookie)).status).toBe(404)
    expect(await app.ops.get(`w:a:notes-widget:${a.accountId}:draft`)).toBe('{"v":"a"}')
    expect((await append(acct('log'), { n: 1 }, a.cookie)).status).toBe(204)
    expect((await get(acct('log'), b.cookie)).status).toBe(404)
    await put(acct('other'), 1, b.cookie)
    expect(await getJson(ACCT_LIST, a.cookie)).toEqual({
      keys: expect.arrayContaining(['draft', 'log']),
    })
    const listed = (await getJson(ACCT_LIST, a.cookie)) as { keys: string[] }
    expect(listed.keys).not.toContain('other')
    expect(listed.keys.every((k) => !k.startsWith('w:a:'))).toBe(true)
    expect(listed.keys).toHaveLength(2)
  })

  it('filters a listing by relative prefix', async () => {
    const a = await app.seedSession('A')
    await put(acct('duty/one'), 1, a.cookie)
    await put(acct('note'), 1, a.cookie)
    expect(await getJson(`${ACCT_LIST}?prefix=duty/`, a.cookie)).toEqual({ keys: ['duty/one'] })
  })

  it('deletes a key and publishes the change', async () => {
    const a = await app.seedSession('A')
    await put(acct('draft'), 1, a.cookie)
    expect((await send('DELETE', acct('draft'), undefined, a.cookie)).status).toBe(204)
    expect((await get(acct('draft'), a.cookie)).status).toBe(404)
  })

  it('returns 401 session_missing for account scope without a cookie', async () => {
    const res = await get(acct('draft'))
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: { code: 'session_missing' } })
    expect((await get(ACCT_LIST)).status).toBe(401)
  })

  it('serves module/shared without a session', async () => {
    const path = '/api/storage/scoped/module/notes/shared/k'
    expect((await put(path, { x: 1 })).status).toBe(204)
    expect(await app.ops.get('m:notes:s:k')).toBe('{"x":1}')
    const res = await get(path)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ value: { x: 1 } })
  })

  it('round-trips an encoded slash in the relative key', async () => {
    const a = await app.seedSession('A')
    const res = await put(acct('duty/ledger'), 1, a.cookie)
    expect(res.status).toBe(204)
    expect(await app.ops.get(`w:a:notes-widget:${a.accountId}:duty/ledger`)).toBe('1')
    expect((await get(acct('duty/ledger'), a.cookie)).status).toBe(200)
  })

  it.each(['a b', 'duty/../x', 'x'.repeat(129)])('rejects key %s with 422', async (key) => {
    const a = await app.seedSession('A')
    const res = await put(acct(key), 1, a.cookie)
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ error: { code: 'scoped_key_invalid' } })
  })

  it('rejects a listing prefix containing .. with 422', async () => {
    const a = await app.seedSession('A')
    const res = await get(`${ACCT_LIST}?prefix=${encodeURIComponent('../x')}`, a.cookie)
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ error: { code: 'scoped_key_invalid' } })
  })

  it('returns 404 for an unknown id and widget/shared, 403 for module board/account', async () => {
    const a = await app.seedSession('A')
    expect((await get('/api/storage/scoped/widget/nope/account/k', a.cookie)).status).toBe(404)
    expect((await get('/api/storage/scoped/widget/notes-widget/shared/k', a.cookie)).status).toBe(
      404,
    )
    expect((await get('/api/storage/scoped/module/nope/shared/k', a.cookie)).status).toBe(404)
    const res = await get('/api/storage/scoped/module/board/account/k', a.cookie)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: { code: 'scoped_scope_undeclared' } })
  })

  it('treats a non-enum owner or scope from the URL as route-unknown 404', async () => {
    const a = await app.seedSession('A')
    expect((await get('/api/storage/scoped/bogus/notes/account/k', a.cookie)).status).toBe(404)
    expect((await get('/api/storage/scoped/module/notes/bogus/k', a.cookie)).status).toBe(404)
  })

  it('keeps m: and w:a: unreachable through /api/storage', async () => {
    const res = await get(`/api/storage/${encodeURIComponent('m:notes:s:k')}`)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: { code: 'storage_forbidden' } })
  })
})
