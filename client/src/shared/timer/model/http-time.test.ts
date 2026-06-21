import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchServerTime, TimeError } from './http-time'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchServerTime', () => {
  it('returns the epoch ms from a valid response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ now: 1_700_000_000_000 }), { status: 200 })),
    )

    expect(await fetchServerTime()).toBe(1_700_000_000_000)
  })

  it('returns a TimeError on a non-ok status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 500 })),
    )

    const result = await fetchServerTime()
    expect(result).toBeInstanceOf(TimeError)
  })

  it('returns a TimeError when the payload shape is invalid', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ now: 'nope' }), { status: 200 })),
    )

    expect(await fetchServerTime()).toBeInstanceOf(TimeError)
  })

  it('returns a TimeError when fetch rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down')
      }),
    )

    expect(await fetchServerTime()).toBeInstanceOf(TimeError)
  })
})
