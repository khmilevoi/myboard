import { makeScriptedHttp } from '@shared/http/test/scripted-http'
import { describe, expect, it } from 'vitest'

import { fetchServerTime, TimeError } from './http-time'

const URL = '/api/time'

describe('fetchServerTime', () => {
  it('returns the epoch ms from a valid response', async () => {
    const { http } = makeScriptedHttp({
      [URL]: [{ status: 200, body: { now: 1_700_000_000_000 } }],
    })

    expect(await fetchServerTime(URL, http)).toBe(1_700_000_000_000)
  })

  it('returns a TimeError on a non-ok status', async () => {
    const { http } = makeScriptedHttp({ [URL]: [{ status: 500 }] })

    const result = await fetchServerTime(URL, http)
    expect(result).toBeInstanceOf(TimeError)
  })

  it('returns a TimeError when the payload shape is invalid', async () => {
    const { http } = makeScriptedHttp({ [URL]: [{ status: 200, body: { now: 'nope' } }] })

    expect(await fetchServerTime(URL, http)).toBeInstanceOf(TimeError)
  })

  it('returns a TimeError when the transport fails', async () => {
    const { http } = makeScriptedHttp({ [URL]: ['network-error'] })

    expect(await fetchServerTime(URL, http)).toBeInstanceOf(TimeError)
  })
})
