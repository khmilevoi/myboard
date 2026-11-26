// @vitest-environment node
import { context, wrap } from '@reatom/core'
import type { FileRef } from '@shared/files/contract'
import { makeScriptedHttp } from '@shared/http/test/scripted-http'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AccountGate } from './account-gate'
import { makeFileSlot, makeHttpFileSlotApi } from './file-slot'
import type { SseDeliver } from './server/sse-client'
import { StorageError } from './types'

afterEach(() => {
  context.reset()
  vi.unstubAllGlobals()
})

const SHARED = { owner: 'module', id: 'cats', scope: 'shared' } as const
const ACCOUNT = { owner: 'module', id: 'cats', scope: 'account' } as const
const SHARED_URL = '/api/files/scoped/module/cats/shared/photo'
const ACCOUNT_URL = '/api/files/scoped/module/cats/account/photo'

const ref = (blobId: string): FileRef => ({
  blobId,
  url: `/files/${blobId}`,
  mime: 'image/webp',
  size: 3,
  image: { width: 1, height: 1 },
  updatedAt: 1,
})
const FIRST = ref('FirstFirstFirst001')
const SECOND = ref('SecondSecondSecond01')

function sseRecorder() {
  const delivers: SseDeliver[] = []
  const registerScoped = vi.fn(
    (_ref: unknown, deliver: SseDeliver, _account?: string) => (delivers.push(deliver), () => {}),
  )
  return { registerScoped, deliver: (value: unknown) => delivers.at(-1)?.(value) }
}

const fixedGate = (accountId: string | null): AccountGate => ({
  current: () => accountId,
  subscribe: (listener) => {
    listener(accountId)
    return () => {}
  },
})

describe('makeFileSlot', () => {
  it('loads the ref on first subscription and follows SSE under the @files/ key', async () => {
    const { http, calls } = makeScriptedHttp({
      [SHARED_URL]: [{ status: 200, body: { value: FIRST } }],
    })
    const sse = sseRecorder()
    const slot = makeFileSlot({ branch: SHARED, key: 'photo', http, ...sse })
    expect(calls).toEqual([])

    const off = slot.ref.subscribe(() => {})
    await vi.waitFor(() => expect(wrap(() => slot.ref())()).toEqual(FIRST))
    expect(wrap(() => slot.isLoading())()).toBe(false)
    expect(sse.registerScoped).toHaveBeenCalledWith(
      { ...SHARED, key: '@files/photo' },
      expect.any(Function),
      undefined,
    )

    sse.deliver(SECOND)
    expect(wrap(() => slot.ref())()).toEqual(SECOND)
    sse.deliver(null)
    expect(wrap(() => slot.ref())()).toBeNull()
    off()
  })

  it('records a malformed SSE frame as an error and keeps the ref', async () => {
    const { http } = makeScriptedHttp({ [SHARED_URL]: [{ status: 200, body: { value: FIRST } }] })
    const sse = sseRecorder()
    const slot = makeFileSlot({ branch: SHARED, key: 'photo', http, ...sse })
    const off = slot.ref.subscribe(() => {})
    await vi.waitFor(() => expect(wrap(() => slot.ref())()).toEqual(FIRST))

    sse.deliver({ blobId: 'x' })
    expect(wrap(() => slot.error())()).toBeInstanceOf(StorageError)
    expect(wrap(() => slot.ref())()).toEqual(FIRST)
    off()
  })

  it('uploads the raw blob with its type and name, and applies the returned ref', async () => {
    const { http, calls } = makeScriptedHttp({
      [SHARED_URL]: [{ status: 200, body: { value: SECOND } }],
    })
    const slot = makeFileSlot({ branch: SHARED, key: 'photo', http, ...sseRecorder() })
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' })

    const result = await slot.upload(blob, { name: 'кот 1.webp' })
    expect(result).toEqual(SECOND)
    expect(calls[0]).toMatchObject({
      method: 'PUT',
      url: SHARED_URL,
      body: blob,
      headers: { 'content-type': 'image/webp', 'x-file-name': encodeURIComponent('кот 1.webp') },
    })
    expect(wrap(() => slot.ref())()).toEqual(SECOND)
  })

  it('returns a StorageError for a rejected upload (413) and leaves the ref alone', async () => {
    const { http } = makeScriptedHttp({ [SHARED_URL]: [{ status: 413 }] })
    const slot = makeFileSlot({ branch: SHARED, key: 'photo', http, ...sseRecorder() })

    const result = await slot.upload(new Blob(['x'], { type: 'image/png' }))
    expect(result).toBeInstanceOf(StorageError)
    expect((result as StorageError).reason).toBe('file upload 413')
    expect(wrap(() => slot.ref())()).toBeNull()
  })

  it('returns a StorageError on a transport failure', async () => {
    const { http } = makeScriptedHttp({ [SHARED_URL]: ['network-error'] })
    const slot = makeFileSlot({ branch: SHARED, key: 'photo', http, ...sseRecorder() })

    const result = await slot.upload(new Blob(['x']))
    expect((result as StorageError).reason).toBe('file upload failed')
  })

  it('refuses to upload while the browser is offline, without a request', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    const { http, calls } = makeScriptedHttp({})
    const slot = makeFileSlot({ branch: SHARED, key: 'photo', http, ...sseRecorder() })

    const result = await slot.upload(new Blob(['x']))
    expect((result as StorageError).reason).toBe('offline')
    expect(calls).toEqual([])
  })

  it('removes the file and clears the ref', async () => {
    const { http, calls } = makeScriptedHttp({
      [SHARED_URL]: [{ status: 200, body: { value: FIRST } }, { status: 204 }],
    })
    const slot = makeFileSlot({ branch: SHARED, key: 'photo', http, ...sseRecorder() })
    await slot.upload(new Blob(['x'], { type: 'image/webp' }))

    expect(await slot.remove()).toBeUndefined()
    expect(calls[1]).toMatchObject({ method: 'DELETE', url: SHARED_URL })
    expect(wrap(() => slot.ref())()).toBeNull()
  })

  it('rejects an invalid key without a request', async () => {
    const { http, calls } = makeScriptedHttp({})
    const slot = makeFileSlot({ branch: SHARED, key: 'a b', http, ...sseRecorder() })
    expect((await slot.upload(new Blob(['x']))) as StorageError).toMatchObject({
      reason: 'invalid_key',
    })
    expect(calls).toEqual([])
  })
})

describe('makeFileSlot on an account branch', () => {
  it('sends the expected-account header and tags the SSE registration', async () => {
    const { http, calls } = makeScriptedHttp({
      [ACCOUNT_URL]: [
        { status: 200, body: { value: null } },
        { status: 200, body: { value: FIRST } },
      ],
    })
    const sse = sseRecorder()
    const slot = makeFileSlot({
      branch: ACCOUNT,
      key: 'photo',
      http,
      ...sse,
      accountGate: fixedGate('acc-1'),
    })

    const off = slot.ref.subscribe(() => {})
    await vi.waitFor(() => expect(wrap(() => slot.isLoading())()).toBe(false))
    await slot.upload(new Blob(['x'], { type: 'image/png' }))

    expect(calls.map((call) => call.headers?.['x-myboard-expected-account'])).toEqual([
      'acc-1',
      'acc-1',
    ])
    expect(sse.registerScoped).toHaveBeenCalledWith(
      { ...ACCOUNT, key: '@files/photo' },
      expect.any(Function),
      'acc-1',
    )
    off()
  })

  it('returns account_unavailable without a request while no account is known', async () => {
    const { http, calls } = makeScriptedHttp({})
    const slot = makeFileSlot({
      branch: ACCOUNT,
      key: 'photo',
      http,
      ...sseRecorder(),
      accountGate: fixedGate(null),
    })
    expect((await slot.upload(new Blob(['x']))) as StorageError).toMatchObject({
      reason: 'account_unavailable',
    })
    expect(calls).toEqual([])
  })
})

describe('makeHttpFileSlotApi', () => {
  it('maps a GET answering { value: null } to null', async () => {
    const { http } = makeScriptedHttp({ [SHARED_URL]: [{ status: 200, body: { value: null } }] })
    const api = makeHttpFileSlotApi({
      branch: SHARED,
      key: 'photo',
      http,
      registerScoped: () => () => {},
    })
    expect(await api.get()).toBeNull()
  })
})
