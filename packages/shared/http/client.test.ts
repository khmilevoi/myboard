import { describe, expect, it, vi } from 'vitest'

import { HttpClient, HttpTransportError, makeUnauthorizedRetryHook } from './client'

function stubFetch(...responses: Array<Response | Error>) {
  const impl = vi.fn<(request: Request) => Promise<Response>>()
  for (const item of responses) {
    if (item instanceof Error) impl.mockRejectedValueOnce(item)
    else impl.mockResolvedValueOnce(item)
  }
  return impl
}

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })

describe('HttpClient', () => {
  it('returns status, ok, and the parsed body for 2xx JSON', async () => {
    const http = new HttpClient({ fetch: stubFetch(json({ a: 1 })) })
    expect(await http.get('http://test.local/x')).toEqual({ status: 200, ok: true, body: { a: 1 } })
  })

  it('returns a non-2xx as a value with its parsed body', async () => {
    const http = new HttpClient({ fetch: stubFetch(json({ code: 'nope' }, 403)) })
    expect(await http.get('http://test.local/x')).toEqual({
      status: 403,
      ok: false,
      body: { code: 'nope' },
    })
  })

  it('maps an empty or non-JSON body on a non-2xx to body undefined (bare nginx 401)', async () => {
    const empty = new HttpClient({ fetch: stubFetch(new Response(null, { status: 401 })) })
    expect(await empty.get('http://test.local/x')).toEqual({
      status: 401,
      ok: false,
      body: undefined,
    })

    const html = new HttpClient({
      fetch: stubFetch(new Response('<html>401</html>', { status: 401 })),
    })
    expect(await html.get('http://test.local/x')).toMatchObject({ status: 401, body: undefined })
  })

  it('maps broken JSON on a 2xx to HttpTransportError', async () => {
    const http = new HttpClient({ fetch: stubFetch(new Response('{oops', { status: 200 })) })
    expect(await http.get('http://test.local/x')).toBeInstanceOf(HttpTransportError)
  })

  it('maps a network failure to HttpTransportError', async () => {
    const http = new HttpClient({ fetch: stubFetch(new Error('boom')) })
    expect(await http.get('http://test.local/x')).toBeInstanceOf(HttpTransportError)
  })

  it('sets the CSRF header on mutating methods only', async () => {
    const fetchMock = stubFetch(new Response(null, { status: 204 }), json({}))
    const http = new HttpClient({ fetch: fetchMock })
    await http.put('http://test.local/x', { json: { a: 1 } })
    expect(fetchMock.mock.calls[0][0].headers.get('x-requested-with')).toBe('MyBoard')
    await http.get('http://test.local/x')
    expect(fetchMock.mock.calls[1][0].headers.get('x-requested-with')).toBeNull()
  })

  it('joins baseUrl with the request path', async () => {
    const fetchMock = stubFetch(json({}))
    const http = new HttpClient({ baseUrl: 'http://test.local/api/', fetch: fetchMock })
    await http.get('/storage/k')
    expect(fetchMock.mock.calls[0][0].url).toBe('http://test.local/api/storage/k')
  })

  it('leaves absolute URLs alone even with a baseUrl', async () => {
    const fetchMock = stubFetch(json({}))
    const http = new HttpClient({ baseUrl: 'http://test.local/api/', fetch: fetchMock })
    await http.get('http://other.local/x')
    expect(fetchMock.mock.calls[0][0].url).toBe('http://other.local/x')
  })

  it('lets an onRequest hook add headers', async () => {
    const fetchMock = stubFetch(json({}))
    const http = new HttpClient({
      fetch: fetchMock,
      onRequest: [({ headers }) => headers.set('x-extra', '1')],
    })
    await http.get('http://test.local/x')
    expect(fetchMock.mock.calls[0][0].headers.get('x-extra')).toBe('1')
  })
})

describe('makeUnauthorizedRetryHook', () => {
  it('replays exactly once after 401 when the handler recovers (POST body re-sent)', async () => {
    const handler = vi.fn(async () => true)
    const fetchMock = stubFetch(
      new Response(null, { status: 401 }),
      new Response(null, { status: 204 }),
    )
    const http = new HttpClient({ fetch: fetchMock, onResponse: [makeUnauthorizedRetryHook(handler)] })

    const result = await http.post('http://test.local/append', { json: { entry: { x: 1 } } })
    expect(result).toMatchObject({ status: 204 })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(await fetchMock.mock.calls[1][0].json()).toEqual({ entry: { x: 1 } })
  })

  it('gives up after one forced replay', async () => {
    const handler = vi.fn(async () => true)
    const fetchMock = stubFetch(
      new Response(null, { status: 401 }),
      new Response(null, { status: 401 }),
    )
    const http = new HttpClient({ fetch: fetchMock, onResponse: [makeUnauthorizedRetryHook(handler)] })
    expect(await http.get('http://test.local/x')).toMatchObject({ status: 401 })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not replay when the handler fails or is absent', async () => {
    const failMock = stubFetch(new Response(null, { status: 401 }))
    const failing = new HttpClient({
      fetch: failMock,
      onResponse: [makeUnauthorizedRetryHook(async () => false)],
    })
    expect(await failing.get('http://test.local/x')).toMatchObject({ status: 401 })
    expect(failMock).toHaveBeenCalledTimes(1)

    const bareMock = stubFetch(new Response(null, { status: 401 }))
    const bare = new HttpClient({ fetch: bareMock })
    expect(await bare.get('http://test.local/x')).toMatchObject({ status: 401 })
    expect(bareMock).toHaveBeenCalledTimes(1)
  })

  it('never touches non-401 responses', async () => {
    const handler = vi.fn(async () => true)
    const http = new HttpClient({
      fetch: stubFetch(new Response(null, { status: 500 })),
      onResponse: [makeUnauthorizedRetryHook(handler)],
    })
    expect(await http.get('http://test.local/x')).toMatchObject({ status: 500 })
    expect(handler).not.toHaveBeenCalled()
  })
})
