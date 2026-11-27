import { HARDWARE_EVENTS_KEY, type HardwareSnapshot } from '@shared/hardware/board-api'
import { makeFakeGateway } from '@shared/hardware/testing/fake-gateway'
import { CSRF_HEADER, CSRF_HEADER_VALUE } from '@shared/http/csrf'
import { afterEach, describe, expect, it } from 'vitest'

import { openSse, startTestApp, type OpenSse, type TestApp } from '../test/app-fixture'

const T0 = Date.parse('2026-06-16T10:00:00.000Z')

let app: TestApp | undefined
const cleanups: (() => void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  await app?.close()
  app = undefined
})

const board = (path: string, method: string, cookie?: string) =>
  fetch(`${app!.base}${path}`, {
    method,
    headers: { [CSRF_HEADER]: CSRF_HEADER_VALUE, ...(cookie ? { cookie } : {}) },
  })

async function signIn() {
  app = await startTestApp()
  return (await app.seedSession('Ann')).cookie
}

async function mintCode(cookie: string): Promise<string> {
  const res = await board('/api/hardware/codes', 'POST', cookie)
  expect(res.status).toBe(201)
  return ((await res.json()) as { code: string }).code
}

async function registeredGateway(cookie: string) {
  const gateway = makeFakeGateway(app!.base)
  await gateway.register(await mintCode(cookie), 'Hall')
  return gateway
}

async function snapshot(cookie: string): Promise<HardwareSnapshot> {
  const res = await board('/api/hardware', 'GET', cookie)
  expect(res.status).toBe(200)
  return (await res.json()) as HardwareSnapshot
}

async function boardEvents(cookie: string): Promise<OpenSse> {
  const sse = await openSse(app!.base, cookie, '/api/hardware/events')
  cleanups.push(sse.close)
  return sse
}

const gatewayFetch = (path: string, init: { method?: string; token?: string; body?: unknown }) =>
  fetch(`${app!.base}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(init.token === undefined ? {} : { authorization: `Bearer ${init.token}` }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  })

async function expectUnauthorized(res: Response) {
  expect(res.status).toBe(401)
  expect(await res.json()).toEqual({
    error: { code: 'gateway_unauthorized', message: 'Gateway is not authorized' },
  })
}

const heartbeat = { type: 'heartbeat', adapter: { powered: true } } as const

describe('hardware routes', () => {
  it('tracks a gateway online while its stream is open', async () => {
    const cookie = await signIn()
    const gateway = await registeredGateway(cookie)
    expect((await snapshot(cookie)).gateways).toMatchObject([
      { id: gateway.gatewayId, label: 'Hall', online: false, connectedAt: null },
    ])

    app!.setNow(T0 + 1_000)
    const stream = await gateway.openStream()
    cleanups.push(stream.close)
    expect(stream.ready).toEqual({ gatewayId: gateway.gatewayId })
    expect((await snapshot(cookie)).gateways[0]).toMatchObject({
      online: true,
      connectedAt: T0 + 1_000,
    })

    const events = await boardEvents(cookie)
    app!.setNow(T0 + 5_000)
    stream.close()
    for (;;) {
      expect(await events.nextFrame()).toEqual({
        key: HARDWARE_EVENTS_KEY,
        value: { type: 'changed' },
      })
      const after = (await snapshot(cookie)).gateways[0]
      if (after?.online === false && after.lastSeenAt === T0 + 5_000) break
    }
  })

  it('tells board subscribers when a gateway registers', async () => {
    const cookie = await signIn()
    const events = await boardEvents(cookie)
    await registeredGateway(cookie)
    expect(await events.nextFrame()).toEqual({
      key: HARDWARE_EVENTS_KEY,
      value: { type: 'changed' },
    })
  })

  it('rejects gateway calls without a valid token', async () => {
    const cookie = await signIn()
    const gateway = await registeredGateway(cookie)
    const revokedToken = gateway.token
    expect(
      (await board(`/api/hardware/gateways/${gateway.gatewayId}`, 'DELETE', cookie)).status,
    ).toBe(204)

    for (const token of [undefined, 'not-a-token', revokedToken]) {
      await expectUnauthorized(await gatewayFetch('/api/hardware/gateway/stream', { token }))
      await expectUnauthorized(
        await gatewayFetch('/api/hardware/gateway/events', {
          method: 'POST',
          token,
          body: { events: [heartbeat] },
        }),
      )
    }
  })

  it('revoking ends an open stream and later events are refused', async () => {
    const cookie = await signIn()
    const gateway = await registeredGateway(cookie)
    const stream = await gateway.openStream()
    cleanups.push(stream.close)

    expect(
      (await board(`/api/hardware/gateways/${gateway.gatewayId}`, 'DELETE', cookie)).status,
    ).toBe(204)
    await expect(stream.nextCommand()).rejects.toThrow('gateway stream ended')
    await expectUnauthorized(await gateway.postEvents([heartbeat]))
    expect((await snapshot(cookie)).gateways).toEqual([])
  })

  it('a second stream replaces the first and the gateway stays online', async () => {
    const cookie = await signIn()
    const gateway = await registeredGateway(cookie)
    const first = await gateway.openStream()
    cleanups.push(first.close)
    const second = await gateway.openStream()
    cleanups.push(second.close)

    await expect(first.nextCommand()).rejects.toThrow('gateway stream ended')
    expect((await snapshot(cookie)).gateways[0]?.online).toBe(true)
  })

  it('board hardware routes require a session', async () => {
    app = await startTestApp()
    expect((await board('/api/hardware', 'GET')).status).toBe(401)
    expect((await board('/api/hardware/codes', 'POST')).status).toBe(401)
    expect((await board('/api/hardware/gateways/x', 'DELETE')).status).toBe(401)
  })

  it('revoking an unknown gateway answers 404', async () => {
    const cookie = await signIn()
    const res = await board('/api/hardware/gateways/x', 'DELETE', cookie)
    expect(res.status).toBe(404)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('gateway_not_found')
  })

  it('a wrong registration code answers 400 gateway_code_invalid', async () => {
    const cookie = await signIn()
    await mintCode(cookie)
    const res = await gatewayFetch('/api/hardware/gateway/register', {
      method: 'POST',
      body: { code: 'AAAA-AAAA', label: 'Hall' },
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'gateway_code_invalid',
    )
  })

  it('validates event batches and stores the heartbeat adapter state', async () => {
    const cookie = await signIn()
    const gateway = await registeredGateway(cookie)
    expect((await gateway.postEvents(Array.from({ length: 51 }, () => heartbeat))).status).toBe(422)
    expect((await snapshot(cookie)).gateways[0]?.adapterPowered).toBeNull()

    expect((await gateway.postEvents([heartbeat])).status).toBe(204)
    expect((await snapshot(cookie)).gateways[0]?.adapterPowered).toBe(true)
  })

  it('stores bonded hardware and reports it as not adopted', async () => {
    const cookie = await signIn()
    const gateway = await registeredGateway(cookie)
    const events = await boardEvents(cookie)
    const bonded = { address: 'aa:bb:cc:dd:ee:01', model: 'beurer-bf950' } as const
    expect((await gateway.postEvents([{ type: 'bonded', hardware: [bonded] }])).status).toBe(204)
    expect(await events.nextFrame()).toEqual({
      key: HARDWARE_EVENTS_KEY,
      value: { type: 'changed' },
    })
    expect((await snapshot(cookie)).gateways[0]?.bondedNotAdopted).toEqual([
      { address: 'AA:BB:CC:DD:EE:01', model: 'beurer-bf950' },
    ])
  })
})
