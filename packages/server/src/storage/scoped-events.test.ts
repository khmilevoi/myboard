import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { openSse, startTestApp, type TestApp } from '../test/app-fixture'
import { isAllowedStorageKey } from './access'
import { makeScopedOwners, resolveScopedNamespace } from './scoped'

const owners = makeScopedOwners({
  widgetTypeIds: [],
  moduleScopes: { notes: ['shared', 'account'] },
})

const ref = { owner: 'module', id: 'notes', scope: 'account', key: 'k' }
const scopedUrl = (r: typeof ref) =>
  `/api/storage/scoped/${r.owner}/${r.id}/${r.scope}/${encodeURIComponent(r.key)}`
const FRAME_KEY = 'scoped:module/notes/account/k'

describe('scoped SSE subscriptions', () => {
  let app: TestApp

  beforeEach(async () => {
    app = await startTestApp({ scopedOwners: owners })
  })
  afterEach(async () => {
    await app.close()
  })

  const headers = (cookie?: string) => ({
    'content-type': 'application/json',
    'X-Requested-With': 'MyBoard',
    ...(cookie ? { cookie } : {}),
  })
  const postEvents = (connId: string, body: unknown, cookie?: string) =>
    fetch(`${app.base}/api/storage/events/${connId}`, {
      method: 'POST',
      headers: headers(cookie),
      body: JSON.stringify(body),
    })
  const put = (path: string, value: unknown, cookie?: string) =>
    fetch(`${app.base}${path}`, {
      method: 'PUT',
      headers: headers(cookie),
      body: JSON.stringify({ value }),
    })
  const settle = () => new Promise<string>((resolve) => setTimeout(() => resolve('none'), 150))

  it('delivers an account write only to the writing account, under the frame key', async () => {
    const a = await app.seedSession('A')
    const b = await app.seedSession('B')
    const sa = await openSse(app.base, a.cookie)
    const sb = await openSse(app.base, b.cookie)
    try {
      const subA = await postEvents(sa.connId, { scoped: { subscribe: [ref] } }, a.cookie)
      const subB = await postEvents(sb.connId, { scoped: { subscribe: [ref] } }, b.cookie)
      expect(subA.status).toBe(204)
      expect(subB.status).toBe(204)
      await put(scopedUrl(ref), 'from-a', a.cookie)
      await put(scopedUrl(ref), 'from-b', b.cookie)
      expect(await sa.nextFrame()).toEqual({ key: FRAME_KEY, value: 'from-a' })
      // B saw no frame from A first.
      expect(await sb.nextFrame()).toEqual({ key: FRAME_KEY, value: 'from-b' })
    } finally {
      sa.close()
      sb.close()
    }
  })

  it('refuses a plain subscribe to an m: key with 403 and subscribes nothing', async () => {
    const a = await app.seedSession('A')
    const other = await app.seedSession('Other')
    const s = await openSse(app.base, a.cookie)
    try {
      const res = await postEvents(
        s.connId,
        { subscribe: [`m:notes:a:${other.accountId}:k`, 'root:ok'] },
        a.cookie,
      )
      expect(res.status).toBe(403)
      expect(await res.json()).toMatchObject({ error: { code: 'storage_forbidden' } })
      await put(scopedUrl(ref), 'x', other.cookie)
      await put('/api/storage/root%3Aok', 'v')
      // 'root:ok' was in the refused batch, so no frame may ever arrive.
      expect(await Promise.race([s.nextFrame(), settle()])).toBe('none')
    } finally {
      s.close()
    }
  })

  it('refuses a plain subscribe to an account: device-event key with 403', async () => {
    const a = await app.seedSession('A')
    const s = await openSse(app.base, a.cookie)
    try {
      const res = await postEvents(s.connId, { subscribe: [`account:${a.accountId}`] }, a.cookie)
      expect(res.status).toBe(403)
      expect(await res.json()).toMatchObject({ error: { code: 'storage_forbidden' } })
    } finally {
      s.close()
    }
  })

  it('returns 401 for a scoped account subscribe without a session', async () => {
    const s = await openSse(app.base)
    try {
      const res = await postEvents(s.connId, { scoped: { subscribe: [ref] } })
      expect(res.status).toBe(401)
    } finally {
      s.close()
    }
  })

  it('rejects an unknown owner id with 404 and a malformed ref with 422', async () => {
    const a = await app.seedSession('A')
    const s = await openSse(app.base, a.cookie)
    try {
      const unknown = await postEvents(
        s.connId,
        { scoped: { subscribe: [{ ...ref, id: 'nope' }] } },
        a.cookie,
      )
      expect(unknown.status).toBe(404)
      const bad = await postEvents(
        s.connId,
        { scoped: { subscribe: [{ ...ref, owner: 'evil' }] } },
        a.cookie,
      )
      expect(bad.status).toBe(422)
    } finally {
      s.close()
    }
  })

  it('stops delivering after a scoped unsubscribe', async () => {
    const a = await app.seedSession('A')
    const s = await openSse(app.base, a.cookie)
    try {
      await postEvents(s.connId, { scoped: { subscribe: [ref] } }, a.cookie)
      await put(scopedUrl(ref), 1, a.cookie)
      expect(await s.nextFrame()).toEqual({ key: FRAME_KEY, value: 1 })
      // Unsubscribe needs no session.
      const res = await postEvents(s.connId, { scoped: { unsubscribe: [ref] } })
      expect(res.status).toBe(204)
      await put(scopedUrl(ref), 2, a.cookie)
      expect(await Promise.race([s.nextFrame(), settle()])).toBe('none')
    } finally {
      s.close()
    }
  })

  it('keeps every scoped namespace outside the plain-subscribe allowlist', () => {
    const o = makeScopedOwners({
      widgetTypeIds: ['notes-widget'],
      moduleScopes: { notes: ['shared', 'account'] },
    })
    const branches = [
      { owner: 'widget', id: 'notes-widget', scope: 'account' },
      { owner: 'module', id: 'notes', scope: 'shared' },
      { owner: 'module', id: 'notes', scope: 'account' },
    ] as const
    for (const branch of branches) {
      const ns = resolveScopedNamespace({ owners: o, branch, accountId: 'acc1' })
      expect(ns).not.toBeInstanceOf(Error)
      expect(isAllowedStorageKey(`${ns as string}k`)).toBe(false)
    }
  })
})
