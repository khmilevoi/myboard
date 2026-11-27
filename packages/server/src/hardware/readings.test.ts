import { latestKey, monthKey } from '@modules/health/domain/keys'
import type { GatewayReading, GatewayReadingsResponse } from '@shared/hardware/gateway-protocol'
import { makeFakeGateway, type FakeGateway } from '@shared/hardware/testing/fake-gateway'
import { CSRF_HEADER, CSRF_HEADER_VALUE } from '@shared/http/csrf'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { makeScopedOwners } from '../storage/scoped'
import { openSse, startTestApp, type TestApp } from '../test/app-fixture'
import { measurementIdFor } from './readings'
import { getHardware, putHardware, updateBindings } from './store'

let app: TestApp | undefined
afterEach(async () => {
  vi.restoreAllMocks()
  await app?.close()
  app = undefined
})

// Epoch ms in 2026-10; no digit run in it is a standalone `83`.
const TAKEN_AT = 1_790_000_000_000
const NEXT_AT = 1_790_000_060_000

const owners = makeScopedOwners({ widgetTypeIds: [], moduleScopes: { health: ['account'] } })

async function registerGateway(cookie: string): Promise<FakeGateway> {
  const res = await fetch(`${app!.base}/api/hardware/codes`, {
    method: 'POST',
    headers: { [CSRF_HEADER]: CSRF_HEADER_VALUE, cookie },
  })
  const { code } = (await res.json()) as { code: string }
  const gateway = makeFakeGateway(app!.base)
  await gateway.register(code, 'Hall')
  return gateway
}

async function seedHardware(id: string, gatewayId: string) {
  await putHardware(app!.ops, {
    id,
    gatewayId,
    address: 'AA:BB:CC:DD:EE:01',
    model: 'beurer-bf950',
    createdAt: 1,
    battery: null,
    lastReadingAt: null,
    scaleUsers: [{ index: 1 }, { index: 2 }, { index: 3 }],
  })
}

async function bind(hardwareId: string, index: number, accountId: string) {
  await updateBindings(app!.ops, hardwareId, (current) => [
    ...current,
    {
      hardwareId,
      index,
      accountId,
      consentCode: '1234',
      createdAt: 1,
      profileRevision: 0,
      appliedRevision: 0,
    },
  ])
}

async function setup() {
  app = await startTestApp({ scopedOwners: owners })
  const a = await app.seedSession('Ann')
  const b = await app.seedSession('Bob')
  const gateway = await registerGateway(a.cookie)
  const hardwareId = 'hw-scale-1'
  await seedHardware(hardwareId, gateway.gatewayId)
  await bind(hardwareId, 1, a.accountId)
  await bind(hardwareId, 2, b.accountId)
  return { a, b, gateway, hardwareId }
}

const weight = (kg: number) => ({ weight: { value: kg, unit: 'kg' } })

function reading(hardwareId: string, over: Partial<GatewayReading> = {}): GatewayReading {
  return {
    ref: 'r1',
    hardwareId,
    scaleUserIndex: 1,
    takenAt: TAKEN_AT,
    metrics: weight(83),
    ...over,
  }
}

async function send(gateway: FakeGateway, ...readings: GatewayReading[]) {
  const res = await gateway.postReadings(readings)
  expect(res.status).toBe(200)
  return ((await res.json()) as GatewayReadingsResponse).results.map((r) => r.status)
}

const healthKeys = async () => (await app!.ops.scanKeys('m:health:')).sort()

describe('reading ingest', () => {
  it('stores a reading in the bound account only and announces it on the scoped stream', async () => {
    const { a, b, gateway, hardwareId } = await setup()
    const sse = await openSse(app!.base, a.cookie)
    try {
      const sub = await fetch(`${app!.base}/api/storage/events/${sse.connId}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Requested-With': 'MyBoard',
          cookie: a.cookie,
        },
        body: JSON.stringify({
          scoped: {
            subscribe: [{ owner: 'module', id: 'health', scope: 'account', key: 'latest/weight' }],
          },
        }),
      })
      expect(sub.status).toBe(204)

      expect(await send(gateway, reading(hardwareId))).toEqual(['stored'])

      const frame = await sse.nextFrame()
      expect(frame.key).toBe('scoped:module/health/account/latest/weight')
      expect(frame.value).toMatchObject({ id: `${hardwareId}:1:${TAKEN_AT}` })

      const ledger = JSON.parse(
        (await app!.ops.get(`m:health:a:${a.accountId}:${monthKey(TAKEN_AT)}`))!,
      ) as unknown[]
      expect(ledger).toMatchObject([
        {
          id: measurementIdFor(hardwareId, 1, TAKEN_AT),
          takenAt: TAKEN_AT,
          metrics: weight(83),
          source: { kind: 'hardware', hardwareId, model: 'beurer-bf950' },
        },
      ])
      expect(await app!.ops.get(`m:health:a:${a.accountId}:${latestKey('weight')}`)).not.toBeNull()
      expect((await healthKeys()).some((k) => k.includes(b.accountId))).toBe(false)
    } finally {
      sse.close()
    }
  })

  it('answers duplicate for a repeat and keeps one ledger entry', async () => {
    const { a, gateway, hardwareId } = await setup()
    expect(await send(gateway, reading(hardwareId))).toEqual(['stored'])
    expect(await send(gateway, reading(hardwareId))).toEqual(['duplicate'])
    const ledger = JSON.parse(
      (await app!.ops.get(`m:health:a:${a.accountId}:${monthKey(TAKEN_AT)}`))!,
    ) as unknown[]
    expect(ledger).toHaveLength(1)
  })

  it('drops a reading for an unbound profile without writing anything', async () => {
    const { gateway, hardwareId } = await setup()
    expect(await send(gateway, reading(hardwareId, { scaleUserIndex: 3 }))).toEqual(['unbound'])
    expect(await healthKeys()).toEqual([])
  })

  it('answers per reading: [stored, rejected, rejected, stored]', async () => {
    const { gateway, hardwareId } = await setup()
    const statuses = await send(
      gateway,
      reading(hardwareId, { ref: 'a' }),
      reading(hardwareId, {
        ref: 'b',
        takenAt: TAKEN_AT + 1,
        metrics: { weight: { value: 183, unit: 'lb' } },
      }),
      reading('hw-unknown', { ref: 'c', takenAt: TAKEN_AT + 2 }),
      reading(hardwareId, { ref: 'd', takenAt: NEXT_AT, scaleUserIndex: 2 }),
    )
    expect(statuses).toEqual(['stored', 'rejected', 'rejected', 'stored'])
  })

  it('rejects hardware that belongs to another gateway', async () => {
    const { a, gateway, hardwareId } = await setup()
    const other = await registerGateway(a.cookie)
    expect(await send(other, reading(hardwareId))).toEqual(['rejected'])
    expect(await healthKeys()).toEqual([])
    expect(await send(gateway, reading(hardwareId))).toEqual(['stored'])
  })

  it('treats a buffered reading as unbound once the profile is unbound', async () => {
    const { a, gateway, hardwareId } = await setup()
    await updateBindings(app!.ops, hardwareId, (current) => current.filter((x) => x.index !== 1))
    expect(await send(gateway, reading(hardwareId))).toEqual(['unbound'])
    expect(await app!.ops.get(`m:health:a:${a.accountId}:${monthKey(TAKEN_AT)}`)).toBeNull()
  })

  it('records lastReadingAt without exposing any metric in the snapshot', async () => {
    const { a, gateway, hardwareId } = await setup()
    await send(gateway, reading(hardwareId))
    await send(gateway, reading(hardwareId, { ref: 'old', takenAt: TAKEN_AT - 5000 }))
    expect(await getHardware(app!.ops, hardwareId)).toMatchObject({ lastReadingAt: TAKEN_AT })
    const res = await fetch(`${app!.base}/api/hardware`, { headers: { cookie: a.cookie } })
    const text = await res.text()
    expect(text).toContain(String(TAKEN_AT))
    expect(text).not.toMatch(/(?<![\w.])83(?![\w.])/)
    expect(text).not.toContain('weight')
  })

  it('answers failed, not a rejected batch, when storage throws', async () => {
    const { gateway, hardwareId } = await setup()
    const realSet = app!.ops.set.bind(app!.ops)
    vi.spyOn(app!.ops, 'set').mockImplementation((key, value, ttl) =>
      key.startsWith('m:health:') ? Promise.reject(new Error('boom')) : realSet(key, value, ttl),
    )
    expect(await send(gateway, reading(hardwareId))).toEqual(['failed'])
  })

  it('refuses readings without a valid gateway token', async () => {
    const { a, hardwareId } = await setup()
    const revoked = await registerGateway(a.cookie)
    const revokedToken = revoked.token
    const del = await fetch(`${app!.base}/api/hardware/gateways/${revoked.gatewayId}`, {
      method: 'DELETE',
      headers: { [CSRF_HEADER]: CSRF_HEADER_VALUE, cookie: a.cookie },
    })
    expect(del.status).toBe(204)
    for (const token of [undefined, 'not-a-token', revokedToken]) {
      const res = await fetch(`${app!.base}/api/hardware/gateway/readings`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({ readings: [reading(hardwareId)] }),
      })
      expect(res.status).toBe(401)
      expect(await res.json()).toMatchObject({ error: { code: 'gateway_unauthorized' } })
    }
    expect(await healthKeys()).toEqual([])
  })
})
