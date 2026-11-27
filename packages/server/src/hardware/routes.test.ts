import { HARDWARE_EVENTS_KEY, type HardwareSnapshot } from '@shared/hardware/board-api'
import { makeFakeGateway } from '@shared/hardware/testing/fake-gateway'
import { CSRF_HEADER, CSRF_HEADER_VALUE } from '@shared/http/csrf'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { openSse, startTestApp, type OpenSse, type TestApp } from '../test/app-fixture'

const T0 = Date.parse('2026-06-16T10:00:00.000Z')

let app: TestApp | undefined
const cleanups: (() => void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  vi.restoreAllMocks()
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
    // Every open starts with the gateway's bindings.
    expect(await stream.nextCommand()).toMatchObject({ type: 'bindings.sync', bindings: [] })

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

    // Skips the open-time bindings.sync, which may or may not reach the first stream in time.
    await expect(first.nextCommand('scan.start')).rejects.toThrow('gateway stream ended')
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

  it('a failing board publish never crashes the server or strands a gateway', async () => {
    const cookie = await signIn()
    const code = await mintCode(cookie)
    const rejections: unknown[] = []
    const onRejection = (reason: unknown) => rejections.push(reason)
    process.on('unhandledRejection', onRejection)
    cleanups.push(() => process.off('unhandledRejection', onRejection))
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    app!.ops.publish = () => Promise.reject(new Error('valkey publish down'))

    // The single-use code is spent and the record stored: the token must still reach the gateway.
    const gateway = makeFakeGateway(app!.base)
    await gateway.register(code, 'Hall')
    expect(gateway.token).toBeTruthy()

    app!.setNow(T0 + 1_000)
    const stream = await gateway.openStream()
    cleanups.push(stream.close)
    expect((await snapshot(cookie)).gateways[0]?.online).toBe(true)

    // A handler's publish failure is a 500 the gateway retries; the write itself is kept.
    const bonded = { address: 'AA:BB:CC:DD:EE:01', model: 'beurer-bf950' } as const
    const failed = await gateway.postEvents([{ type: 'bonded', hardware: [bonded] }])
    expect(failed.status).toBe(500)
    expect(((await failed.json()) as { error: { code: string } }).error.code).toBe('internal_error')

    app!.setNow(T0 + 5_000)
    stream.close()
    let after = (await snapshot(cookie)).gateways[0]
    for (let attempt = 0; attempt < 100 && after?.lastSeenAt !== T0 + 5_000; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      after = (await snapshot(cookie)).gateways[0]
    }
    expect(after).toMatchObject({ online: false, lastSeenAt: T0 + 5_000 })

    expect(
      (await board(`/api/hardware/gateways/${gateway.gatewayId}`, 'DELETE', cookie)).status,
    ).toBe(204)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(rejections).toEqual([])
    expect((await snapshot(cookie)).gateways).toEqual([])
    expect(JSON.stringify(logged.mock.calls)).not.toContain(gateway.token)
  })
})
