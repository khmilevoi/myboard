import { describe, expect, it } from 'vitest'

import { HttpTransportError } from '../http/client'
import { makeScriptedHttp } from '../http/test/scripted-http'
import {
  HardwareRequestError,
  HardwareResponseError,
  isHardwareError,
  makeHardwareBoardClient,
} from './board-client'

const SNAPSHOT = { gateways: [], hardware: [] }

describe('makeHardwareBoardClient', () => {
  it('snapshot parses a 200 body', async () => {
    const { http } = makeScriptedHttp({ '/api/hardware': [{ status: 200, body: SNAPSHOT }] })
    expect(await makeHardwareBoardClient(http).snapshot()).toEqual(SNAPSHOT)
  })

  it('snapshot with a body the schema rejects is a HardwareResponseError', async () => {
    const { http } = makeScriptedHttp({ '/api/hardware': [{ status: 200, body: { gateways: 1 } }] })
    expect(await makeHardwareBoardClient(http).snapshot()).toBeInstanceOf(HardwareResponseError)
  })

  it('a 409 gateway_offline body becomes HardwareRequestError { status: 409, code: gateway_offline }', async () => {
    const { http } = makeScriptedHttp({
      '/api/hardware/gateways/g1/scan': [
        { status: 409, body: { error: { code: 'gateway_offline', message: 'offline' } } },
      ],
    })
    const result = await makeHardwareBoardClient(http).scan('g1', 'start')
    expect(result).toBeInstanceOf(HardwareRequestError)
    const error = result as HardwareRequestError
    expect(error.status).toBe(409)
    expect(error.code).toBe('gateway_offline')
    expect(isHardwareError(error, 'gateway_offline')).toBe(true)
    expect(isHardwareError(error, 'hardware_not_found')).toBe(false)
    expect(isHardwareError(new Error('x'), 'gateway_offline')).toBe(false)
  })

  it("a non-2xx without a parsable error body has code 'unknown'", async () => {
    const { http } = makeScriptedHttp({ '/api/hardware': [{ status: 502 }] })
    const result = await makeHardwareBoardClient(http).snapshot()
    expect(result).toBeInstanceOf(HardwareRequestError)
    expect((result as HardwareRequestError).code).toBe('unknown')
    expect((result as HardwareRequestError).status).toBe(502)
  })

  it('an error code outside the contract is unknown', async () => {
    const { http } = makeScriptedHttp({
      '/api/hardware': [{ status: 400, body: { error: { code: 'brand_new', message: 'm' } } }],
    })
    const result = await makeHardwareBoardClient(http).snapshot()
    expect((result as HardwareRequestError).code).toBe('unknown')
  })

  it('a network error is returned as HttpTransportError', async () => {
    const { http } = makeScriptedHttp({ '/api/hardware': ['network-error'] })
    expect(await makeHardwareBoardClient(http).snapshot()).toBeInstanceOf(HttpTransportError)
  })

  it('an unexpected 2xx status is a HardwareRequestError', async () => {
    const { http } = makeScriptedHttp({ '/api/hardware/codes': [{ status: 200, body: {} }] })
    expect(await makeHardwareBoardClient(http).mintCode()).toBeInstanceOf(HardwareRequestError)
  })

  it('requestProfile sends { mode: attach, index: 3, consentCode } to an encoded path', async () => {
    const url = '/api/hardware/items/h%2F1/profiles'
    const { http, calls } = makeScriptedHttp({
      [url]: [{ status: 202, body: { commandId: 'c1' } }],
    })
    const result = await makeHardwareBoardClient(http).requestProfile('h/1', {
      mode: 'attach',
      index: 3,
      consentCode: '1234',
    })
    expect(result).toEqual({ commandId: 'c1' })
    expect(calls).toEqual([
      expect.objectContaining({
        method: 'POST',
        url,
        json: { mode: 'attach', index: 3, consentCode: '1234' },
      }),
    ])
  })

  it('unbind DELETEs the profile path and resolves undefined on 204', async () => {
    const { http, calls } = makeScriptedHttp({
      '/api/hardware/items/h1/profiles/2': [{ status: 204 }],
    })
    expect(await makeHardwareBoardClient(http).unbind('h1', 2)).toBeUndefined()
    expect(calls[0]).toEqual(expect.objectContaining({ method: 'DELETE' }))
  })

  it('submitPin and pair send their bodies', async () => {
    const { http, calls } = makeScriptedHttp({
      '/api/hardware/gateways/g1/pairings': [{ status: 202, body: { pairingId: 'p1' } }],
      '/api/hardware/pairings/p1/pin': [{ status: 202 }],
    })
    const client = makeHardwareBoardClient(http)
    expect(await client.pair('g1', 'AA:BB:CC:DD:EE:FF')).toEqual({ pairingId: 'p1' })
    expect(await client.submitPin('p1', '123456')).toBeUndefined()
    expect(calls.map((c) => c.json)).toEqual([{ address: 'AA:BB:CC:DD:EE:FF' }, { pin: '123456' }])
  })

  it('revealConsentCode reads the code on 200', async () => {
    const { http } = makeScriptedHttp({
      '/api/hardware/items/h1/profiles/2/consent-code': [
        { status: 200, body: { consentCode: '4321' } },
      ],
    })
    expect(await makeHardwareBoardClient(http).revealConsentCode('h1', 2)).toEqual({
      consentCode: '4321',
    })
  })
})
