import { HARDWARE_EVENTS_KEY, type HardwareSnapshot } from '@shared/hardware/board-api'
import type { GatewayEvent } from '@shared/hardware/gateway-protocol'
import { makeFakeGateway, type FakeGateway } from '@shared/hardware/testing/fake-gateway'
import { CSRF_HEADER, CSRF_HEADER_VALUE } from '@shared/http/csrf'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { openSse, startTestApp, type OpenSse, type TestApp } from '../test/app-fixture'
import { updateBindings } from './store'

let app: TestApp | undefined
const cleanups: (() => void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  vi.restoreAllMocks()
  await app?.close()
  app = undefined
})

const ADDRESS = 'AA:BB:CC:DD:EE:01'
const OTHER_ADDRESS = 'AA:BB:CC:DD:EE:02'

const board = (path: string, method: string, cookie: string, body?: unknown) =>
  fetch(`${app!.base}${path}`, {
    method,
    headers: {
      [CSRF_HEADER]: CSRF_HEADER_VALUE,
      cookie,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

async function snapshot(cookie: string): Promise<HardwareSnapshot> {
  const res = await board('/api/hardware', 'GET', cookie)
  expect(res.status).toBe(200)
  return (await res.json()) as HardwareSnapshot
}

async function register(cookie: string): Promise<FakeGateway> {
  const res = await board('/api/hardware/codes', 'POST', cookie)
  const { code } = (await res.json()) as { code: string }
  const gateway = makeFakeGateway(app!.base)
  await gateway.register(code, 'Hall')
  return gateway
}

async function setup() {
  app = await startTestApp()
  const session = await app.seedSession('Ann')
  const gateway = await register(session.cookie)
  const stream = await gateway.openStream()
  cleanups.push(stream.close)
  // The open-time sync, so later assertions see only the syncs their own action caused.
  await stream.nextCommand('bindings.sync')
  return { cookie: session.cookie, accountId: session.accountId, gateway, stream }
}

async function boardEvents(cookie: string): Promise<OpenSse> {
  const sse = await openSse(app!.base, cookie, '/api/hardware/events')
  cleanups.push(sse.close)
  return sse
}

async function post(gateway: FakeGateway, ...events: GatewayEvent[]) {
  const res = await gateway.postEvents(events)
  expect(res.status).toBe(204)
}

async function nextBoardValue(events: OpenSse, type: string) {
  for (;;) {
    const frame = await events.nextFrame()
    expect(frame.key).toBe(HARDWARE_EVENTS_KEY)
    const value = frame.value as { type: string }
    if (value.type === type) return value
  }
}

const scanResult = (address = ADDRESS, rssi = -60): GatewayEvent => ({
  type: 'scan.result',
  address,
  name: 'BF950',
  rssi,
  model: 'beurer-bf950',
})

async function scanAndPair(ctx: Awaited<ReturnType<typeof setup>>, address = ADDRESS) {
  const { cookie, gateway, stream } = ctx
  expect(
    (
      await board(`/api/hardware/gateways/${gateway.gatewayId}/scan`, 'POST', cookie, {
        action: 'start',
      })
    ).status,
  ).toBe(202)
  await stream.nextCommand('scan.start')
  await post(gateway, scanResult(address))
  const paired = await board(
    `/api/hardware/gateways/${gateway.gatewayId}/pairings`,
    'POST',
    cookie,
    {
      address,
    },
  )
  expect(paired.status).toBe(202)
  const { pairingId } = (await paired.json()) as { pairingId: string }
  return pairingId
}

describe('scan', () => {
  it('starts a scan, records results and finishes it', async () => {
    const { cookie, gateway, stream } = await setup()
    const events = await boardEvents(cookie)

    const started = await board(
      `/api/hardware/gateways/${gateway.gatewayId}/scan`,
      'POST',
      cookie,
      { action: 'start' },
    )
    expect(started.status).toBe(202)
    expect(await stream.nextCommand('scan.start')).toMatchObject({ durationMs: 30_000 })
    expect((await snapshot(cookie)).gateways[0]?.scan).toMatchObject({ active: true, results: [] })

    await post(gateway, scanResult(ADDRESS, -70), scanResult(ADDRESS, -55))
    expect(await nextBoardValue(events, 'scan.result')).toMatchObject({
      gatewayId: gateway.gatewayId,
      result: { address: ADDRESS, rssi: -70 },
    })
    const results = (await snapshot(cookie)).gateways[0]?.scan?.results
    expect(results).toEqual([{ address: ADDRESS, name: 'BF950', rssi: -55, model: 'beurer-bf950' }])

    // A model the server does not know is dropped; the rest of the batch is still applied.
    await post(
      gateway,
      { ...scanResult(OTHER_ADDRESS), model: 'other' } as unknown as GatewayEvent,
      scanResult('AA:BB:CC:DD:EE:03', -40),
    )
    // The first batch published two frames for one address; skip to the new one.
    for (;;) {
      const frame = (await nextBoardValue(events, 'scan.result')) as unknown as {
        result: { address: string }
      }
      if (frame.result.address === 'AA:BB:CC:DD:EE:03') break
      expect(frame.result.address).toBe(ADDRESS)
    }
    expect((await snapshot(cookie)).gateways[0]?.scan?.results).toHaveLength(2)

    await post(gateway, { type: 'scan.finished' })
    expect(await nextBoardValue(events, 'scan.finished')).toMatchObject({
      gatewayId: gateway.gatewayId,
    })
    expect((await snapshot(cookie)).gateways[0]?.scan?.active).toBe(false)
  })

  it('stop sends scan.stop and marks the scan inactive', async () => {
    const { cookie, gateway, stream } = await setup()
    await board(`/api/hardware/gateways/${gateway.gatewayId}/scan`, 'POST', cookie, {
      action: 'start',
    })
    await stream.nextCommand('scan.start')
    const stopped = await board(
      `/api/hardware/gateways/${gateway.gatewayId}/scan`,
      'POST',
      cookie,
      {
        action: 'stop',
      },
    )
    expect(stopped.status).toBe(202)
    await stream.nextCommand('scan.stop')
    expect((await snapshot(cookie)).gateways[0]?.scan?.active).toBe(false)
  })

  it('answers 409 gateway_offline for every command while the gateway is offline', async () => {
    app = await startTestApp()
    const { cookie } = await app.seedSession('Ann')
    const gateway = await register(cookie)
    const id = gateway.gatewayId
    const offline = { error: { code: 'gateway_offline', message: 'Gateway is offline' } }

    for (const [path, body] of [
      [`/api/hardware/gateways/${id}/scan`, { action: 'start' }],
      [`/api/hardware/gateways/${id}/scan`, { action: 'stop' }],
      [`/api/hardware/gateways/${id}/pairings`, { address: ADDRESS }],
      [`/api/hardware/gateways/${id}/adopt`, { address: ADDRESS }],
    ] as const) {
      const res = await board(path, 'POST', cookie, body)
      expect(res.status).toBe(409)
      expect(await res.json()).toEqual(offline)
    }
  })

  it('sends a board command only to the gateway’s newest stream', async () => {
    const { cookie, gateway, stream: first } = await setup()
    const second = await gateway.openStream()
    cleanups.push(second.close)

    await board(`/api/hardware/gateways/${gateway.gatewayId}/scan`, 'POST', cookie, {
      action: 'start',
    })
    expect(await second.nextCommand('scan.start')).toMatchObject({ type: 'scan.start' })
    // The replaced stream was ended, so it can only fail, never deliver the command.
    await expect(first.nextCommand('scan.start')).rejects.toThrow()
  })
})

describe('pairing', () => {
  it('walks connecting, PIN, rejected PIN, accepted PIN and bonded', async () => {
    const ctx = await setup()
    const { cookie, gateway, stream } = ctx
    const events = await boardEvents(cookie)
    const pairingId = await scanAndPair(ctx)
    expect(await stream.nextCommand('pair')).toMatchObject({
      pairingId,
      address: ADDRESS,
      model: 'beurer-bf950',
    })

    // Stages come only from the gateway: a PIN now is refused.
    const early = await board(`/api/hardware/pairings/${pairingId}/pin`, 'POST', cookie, {
      pin: '123456',
    })
    expect(early.status).toBe(409)

    await post(gateway, { type: 'pairing.progress', pairingId, stage: 'pin_required' })
    expect(await nextBoardValue(events, 'pairing')).toMatchObject({ stage: 'connecting' })
    expect(await nextBoardValue(events, 'pairing')).toMatchObject({
      pairingId,
      stage: 'pin_required',
      hardwareId: null,
    })

    const pin = await board(`/api/hardware/pairings/${pairingId}/pin`, 'POST', cookie, {
      pin: '123456',
    })
    expect(pin.status).toBe(202)
    expect(await stream.nextCommand('pairing.pin')).toMatchObject({ pairingId, pin: '123456' })

    await post(gateway, { type: 'pairing.progress', pairingId, stage: 'pin_rejected' })
    const again = await board(`/api/hardware/pairings/${pairingId}/pin`, 'POST', cookie, {
      pin: '654321',
    })
    expect(again.status).toBe(202)
    expect(await stream.nextCommand('pairing.pin')).toMatchObject({ pin: '654321' })

    await post(gateway, { type: 'pairing.progress', pairingId, stage: 'bonded' })
    const bonded = await snapshot(cookie)
    expect(bonded.hardware).toMatchObject([{ gatewayId: gateway.gatewayId, address: ADDRESS }])

    // A repeat changes nothing.
    await post(gateway, { type: 'pairing.progress', pairingId, stage: 'bonded' })
    expect((await snapshot(cookie)).hardware).toHaveLength(1)
  })

  it('refuses an address that was not scanned, and one already adopted', async () => {
    const ctx = await setup()
    const { cookie, gateway } = ctx
    const unknown = await board(
      `/api/hardware/gateways/${gateway.gatewayId}/pairings`,
      'POST',
      cookie,
      { address: ADDRESS },
    )
    expect(unknown.status).toBe(404)
    expect(await unknown.json()).toEqual({
      error: { code: 'scan_result_unknown', message: 'No such scan result' },
    })

    const pairingId = await scanAndPair(ctx)
    await post(gateway, { type: 'pairing.progress', pairingId, stage: 'bonded' })
    const dup = await board(
      `/api/hardware/gateways/${gateway.gatewayId}/pairings`,
      'POST',
      cookie,
      {
        address: ADDRESS,
      },
    )
    expect(dup.status).toBe(409)
  })

  it('answers 404 for an unknown pairing and ignores progress for one', async () => {
    const { cookie, gateway } = await setup()
    const res = await board('/api/hardware/pairings/nope/pin', 'POST', cookie, { pin: '123456' })
    expect(res.status).toBe(404)
    await post(gateway, { type: 'pairing.progress', pairingId: 'nope', stage: 'bonded' })
    expect((await snapshot(cookie)).hardware).toEqual([])
  })

  it('stores neither the PIN nor logs it', async () => {
    const ctx = await setup()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const pairingId = await scanAndPair(ctx)
    await post(ctx.gateway, { type: 'pairing.progress', pairingId, stage: 'pin_required' })
    await board(`/api/hardware/pairings/${pairingId}/pin`, 'POST', ctx.cookie, { pin: '987654' })
    const keys = await app!.ops.scanKeys('hw:')
    expect(keys.length).toBeGreaterThan(0)
    for (const key of keys) {
      expect(await app!.ops.get(key)).not.toContain('987654')
    }
    expect(JSON.stringify(log.mock.calls)).not.toContain('987654')
  })
})

describe('battery and scale users', () => {
  it('records battery and scale users for the gateway’s own hardware only', async () => {
    const ctx = await setup()
    const { cookie, gateway } = ctx
    const pairingId = await scanAndPair(ctx)
    await post(gateway, { type: 'pairing.progress', pairingId, stage: 'bonded' })
    const hardwareId = (await snapshot(cookie)).hardware[0]!.id

    await post(
      gateway,
      { type: 'battery', hardwareId, percent: 80 },
      { type: 'scaleUsers', hardwareId, users: [{ index: 2 }] },
    )
    expect((await snapshot(cookie)).hardware[0]).toMatchObject({
      battery: 80,
      profiles: [{ index: 2, binding: 'none' }],
    })

    const stranger = await register(cookie)
    await post(stranger, { type: 'battery', hardwareId, percent: 1 })
    expect((await snapshot(cookie)).hardware[0]?.battery).toBe(80)
  })
})

describe('adopt, revoke and unpair', () => {
  it('adopts a bonded scale without pairing, keeps bindings across revoke, and relinks it', async () => {
    const { cookie, accountId, gateway, stream } = await setup()
    await post(gateway, {
      type: 'bonded',
      hardware: [{ address: ADDRESS, model: 'beurer-bf950' }],
    })
    expect((await snapshot(cookie)).gateways[0]?.bondedNotAdopted).toEqual([
      { address: ADDRESS, model: 'beurer-bf950' },
    ])

    const adopted = await board(
      `/api/hardware/gateways/${gateway.gatewayId}/adopt`,
      'POST',
      cookie,
      {
        address: ADDRESS,
      },
    )
    expect(adopted.status).toBe(200)
    const { hardwareId } = (await adopted.json()) as { hardwareId: string }
    expect(await stream.nextCommand('bindings.sync')).toMatchObject({ bindings: [] })
    expect((await snapshot(cookie)).hardware).toMatchObject([{ id: hardwareId }])

    const again = await board(`/api/hardware/gateways/${gateway.gatewayId}/adopt`, 'POST', cookie, {
      address: ADDRESS,
    })
    expect(again.status).toBe(409)
    const missing = await board(
      `/api/hardware/gateways/${gateway.gatewayId}/adopt`,
      'POST',
      cookie,
      {
        address: OTHER_ADDRESS,
      },
    )
    expect(missing.status).toBe(404)

    await updateBindings(app!.ops, hardwareId, () => [
      {
        hardwareId,
        index: 1,
        accountId,
        consentCode: '4821',
        createdAt: 1,
        profileRevision: 1,
        appliedRevision: 1,
      },
    ])
    expect(
      (await board(`/api/hardware/gateways/${gateway.gatewayId}`, 'DELETE', cookie)).status,
    ).toBe(204)
    const detached = (await snapshot(cookie)).hardware[0]
    expect(detached).toMatchObject({
      id: hardwareId,
      gatewayId: null,
      profiles: [{ index: 1, binding: 'mine' }],
    })

    const next = await register(cookie)
    const nextStream = await next.openStream()
    cleanups.push(nextStream.close)
    await nextStream.nextCommand('bindings.sync')
    await post(next, { type: 'bonded', hardware: [{ address: ADDRESS, model: 'beurer-bf950' }] })
    const relinked = await board(`/api/hardware/gateways/${next.gatewayId}/adopt`, 'POST', cookie, {
      address: ADDRESS,
    })
    expect(((await relinked.json()) as { hardwareId: string }).hardwareId).toBe(hardwareId)
    expect(await nextStream.nextCommand('bindings.sync')).toMatchObject({
      bindings: [{ hardwareId, address: ADDRESS, index: 1, consentCode: '4821' }],
    })
    expect((await snapshot(cookie)).hardware[0]).toMatchObject({
      gatewayId: next.gatewayId,
      profiles: [{ index: 1, binding: 'mine' }],
    })
  })

  it('re-pairing a detached scale on a new gateway relinks it and syncs its bindings', async () => {
    const ctx = await setup()
    const { cookie, accountId, gateway } = ctx
    const pairingId = await scanAndPair(ctx)
    await post(gateway, { type: 'pairing.progress', pairingId, stage: 'bonded' })
    const hardwareId = (await snapshot(cookie)).hardware[0]!.id
    await updateBindings(app!.ops, hardwareId, () => [
      {
        hardwareId,
        index: 2,
        accountId,
        consentCode: '0310',
        createdAt: 1,
        profileRevision: 0,
        appliedRevision: 0,
      },
    ])
    expect(
      (await board(`/api/hardware/gateways/${gateway.gatewayId}`, 'DELETE', cookie)).status,
    ).toBe(204)

    const next = await register(cookie)
    const nextStream = await next.openStream()
    cleanups.push(nextStream.close)
    await nextStream.nextCommand('bindings.sync')
    const nextCtx = { ...ctx, gateway: next, stream: nextStream }
    const repaired = await scanAndPair(nextCtx)
    await post(next, { type: 'pairing.progress', pairingId: repaired, stage: 'bonded' })
    expect(await nextStream.nextCommand('bindings.sync')).toMatchObject({
      bindings: [{ hardwareId, address: ADDRESS, index: 2, consentCode: '0310' }],
    })
    expect((await snapshot(cookie)).hardware).toMatchObject([
      { id: hardwareId, gatewayId: next.gatewayId, profiles: [{ index: 2, binding: 'mine' }] },
    ])
  })

  it('unpair tells the gateway and removes the hardware with its bindings', async () => {
    const { cookie, accountId, gateway, stream } = await setup()
    await post(gateway, { type: 'bonded', hardware: [{ address: ADDRESS, model: 'beurer-bf950' }] })
    const adopted = await board(
      `/api/hardware/gateways/${gateway.gatewayId}/adopt`,
      'POST',
      cookie,
      {
        address: ADDRESS,
      },
    )
    const { hardwareId } = (await adopted.json()) as { hardwareId: string }
    await updateBindings(app!.ops, hardwareId, () => [
      {
        hardwareId,
        index: 1,
        accountId,
        consentCode: '4821',
        createdAt: 1,
        profileRevision: 1,
        appliedRevision: 1,
      },
    ])

    const res = await board(`/api/hardware/items/${hardwareId}`, 'DELETE', cookie)
    expect(res.status).toBe(204)
    expect(await stream.nextCommand('unpair')).toMatchObject({ hardwareId, address: ADDRESS })
    expect((await snapshot(cookie)).hardware).toEqual([])
    expect(await app!.ops.get(`hw:bindings:${hardwareId}`)).toBeNull()
    expect((await board(`/api/hardware/items/${hardwareId}`, 'DELETE', cookie)).status).toBe(404)
  })

  it('unpair of attached hardware needs the gateway online; detached hardware does not', async () => {
    const { cookie, gateway, stream } = await setup()
    await post(gateway, { type: 'bonded', hardware: [{ address: ADDRESS, model: 'beurer-bf950' }] })
    const adopted = await board(
      `/api/hardware/gateways/${gateway.gatewayId}/adopt`,
      'POST',
      cookie,
      {
        address: ADDRESS,
      },
    )
    const { hardwareId } = (await adopted.json()) as { hardwareId: string }

    stream.close()
    for (;;) {
      if (!(await snapshot(cookie)).gateways[0]?.online) break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const offline = await board(`/api/hardware/items/${hardwareId}`, 'DELETE', cookie)
    expect(offline.status).toBe(409)

    await board(`/api/hardware/gateways/${gateway.gatewayId}`, 'DELETE', cookie)
    expect((await board(`/api/hardware/items/${hardwareId}`, 'DELETE', cookie)).status).toBe(204)
  })
})
