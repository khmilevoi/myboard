import { PROFILE_KEY } from '@modules/health/domain/keys'
import type { Profile } from '@modules/health/domain/profile'
import type { HardwareSnapshot } from '@shared/hardware/board-api'
import type { GatewayEvent } from '@shared/hardware/gateway-protocol'
import {
  makeFakeGateway,
  type FakeGateway,
  type FakeGatewayStream,
} from '@shared/hardware/testing/fake-gateway'
import { CSRF_HEADER, CSRF_HEADER_VALUE } from '@shared/http/csrf'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { startTestApp, type TestApp } from '../test/app-fixture'
import { healthStorageFor } from './health-access'
import { healthProfileAccountId } from './profile-sync'
import { getBindings, updateBindings } from './store'

let app: TestApp | undefined
const cleanups: (() => void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  vi.restoreAllMocks()
  await app?.close()
  app = undefined
})

const ADDRESS = 'AA:BB:CC:DD:EE:01'
const PROFILE: Profile = { heightCm: 170, birthDate: '1988-02-01', sex: 'female' }

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

async function post(gateway: FakeGateway, ...events: GatewayEvent[]) {
  const res = await gateway.postEvents(events)
  expect(res.status).toBe(204)
}

async function snapshot(cookie: string): Promise<HardwareSnapshot> {
  const res = await board('/api/hardware', 'GET', cookie)
  expect(res.status).toBe(200)
  return (await res.json()) as HardwareSnapshot
}

async function setup() {
  app = await startTestApp()
  const a = await app.seedSession('Ann')
  const b = await app.seedSession('Bob')
  const minted = await board('/api/hardware/codes', 'POST', a.cookie)
  const gateway = makeFakeGateway(app.base)
  await gateway.register(((await minted.json()) as { code: string }).code, 'Hall')
  const stream = await gateway.openStream()
  await post(gateway, { type: 'bonded', hardware: [{ address: ADDRESS, model: 'beurer-bf950' }] })
  const adopted = await board(
    `/api/hardware/gateways/${gateway.gatewayId}/adopt`,
    'POST',
    a.cookie,
    { address: ADDRESS },
  )
  const { hardwareId } = (await adopted.json()) as { hardwareId: string }
  await updateBindings(app.ops, hardwareId, () => [
    {
      hardwareId,
      index: 1,
      accountId: a.accountId,
      consentCode: '4821',
      createdAt: 1,
      profileRevision: 0,
      appliedRevision: 0,
    },
  ])
  return { a, b, gateway, stream, hardwareId }
}

async function goOffline(stream: FakeGatewayStream, cookie: string) {
  stream.close()
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (!(await snapshot(cookie)).gateways[0]?.online) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('gateway stayed online')
}

async function reopen(gateway: FakeGateway) {
  const stream = await gateway.openStream()
  cleanups.push(stream.close)
  return stream
}

/** Proves nothing else is queued: a scan start must be the very next command. */
async function expectNothingQueued(
  stream: FakeGatewayStream,
  gateway: FakeGateway,
  cookie: string,
) {
  const res = await board(`/api/hardware/gateways/${gateway.gatewayId}/scan`, 'POST', cookie, {
    action: 'start',
  })
  expect(res.status).toBe(202)
  expect((await stream.nextCommand()).type).toBe('scan.start')
}

const setProfile = (accountId: string, profile: Profile) =>
  healthStorageFor(app!.ops, Date.now, accountId).set(PROFILE_KEY, profile)

describe('profile sync', () => {
  it('remembers a profile change made offline and resends it on every open until acked', async () => {
    const { a, b, gateway, stream, hardwareId } = await setup()
    await goOffline(stream, a.cookie)

    expect(await setProfile(a.accountId, { ...PROFILE, heightCm: 172 })).toBeUndefined()
    await vi.waitFor(async () => {
      const bindings = await getBindings(app!.ops, hardwareId)
      expect(bindings instanceof Error ? bindings : bindings[0]?.profileRevision).toBe(1)
    })

    const first = await reopen(gateway)
    expect(await first.nextCommand()).toMatchObject({
      type: 'bindings.sync',
      bindings: [{ hardwareId, index: 1, consentCode: '4821' }],
    })
    expect(await first.nextCommand()).toMatchObject({
      type: 'scaleUser.update',
      hardwareId,
      address: ADDRESS,
      index: 1,
      consentCode: '4821',
      profile: { heightCm: 172, birthDate: '1988-02-01', sex: 'female' },
      revision: 1,
    })

    // No ack: the next open sends it again.
    await goOffline(first, a.cookie)
    const second = await reopen(gateway)
    expect((await second.nextCommand()).type).toBe('bindings.sync')
    expect(await second.nextCommand()).toMatchObject({ type: 'scaleUser.update', revision: 1 })

    // Acked: the next open sends only the sync.
    await post(gateway, { type: 'scaleUser.updated', hardwareId, index: 1, revision: 1 })
    await goOffline(second, a.cookie)
    const third = await reopen(gateway)
    expect((await third.nextCommand()).type).toBe('bindings.sync')
    await expectNothingQueued(third, gateway, a.cookie)

    // An account without a binding causes no command.
    expect(await setProfile(b.accountId, PROFILE)).toBeUndefined()
    await expectNothingQueued(third, gateway, a.cookie)

    // A measurement write is not a profile change.
    expect(
      await healthStorageFor(app!.ops, Date.now, a.accountId).set('measurements/2026-11', []),
    ).toBeUndefined()
    await expectNothingQueued(third, gateway, a.cookie)
    const bindings = await getBindings(app!.ops, hardwareId)
    expect(bindings instanceof Error ? bindings : bindings[0]).toMatchObject({
      profileRevision: 1,
      appliedRevision: 1,
    })

    // Online, a change goes out at once.
    expect(await setProfile(a.accountId, { ...PROFILE, heightCm: 174 })).toBeUndefined()
    expect(await third.nextCommand()).toMatchObject({
      type: 'scaleUser.update',
      revision: 2,
      profile: { heightCm: 174 },
    })
  })

  it('ignores an update ack from a gateway that does not own the hardware', async () => {
    const { a, gateway, stream, hardwareId } = await setup()
    cleanups.push(stream.close)
    expect(await setProfile(a.accountId, PROFILE)).toBeUndefined()
    expect(await stream.nextCommand('scaleUser.update')).toMatchObject({ revision: 1 })

    const minted = await board('/api/hardware/codes', 'POST', a.cookie)
    const stranger = makeFakeGateway(app!.base)
    await stranger.register(((await minted.json()) as { code: string }).code, 'Other')
    await post(stranger, { type: 'scaleUser.updated', hardwareId, index: 1, revision: 1 })
    const bindings = await getBindings(app!.ops, hardwareId)
    expect(bindings instanceof Error ? bindings : bindings[0]?.appliedRevision).toBe(0)

    await post(gateway, { type: 'scaleUser.updated', hardwareId, index: 1, revision: 1 })
    const acked = await getBindings(app!.ops, hardwareId)
    expect(acked instanceof Error ? acked : acked[0]?.appliedRevision).toBe(1)
  })
})

describe('healthProfileAccountId', () => {
  it('matches exactly the health profile key of one account', () => {
    expect(healthProfileAccountId('m:health:a:acc-1:profile')).toBe('acc-1')
    expect(healthProfileAccountId('m:health:a:acc-1:profile/x')).toBeNull()
    expect(healthProfileAccountId('m:health:a:acc-1:measurements/2026-11')).toBeNull()
    expect(healthProfileAccountId('m:health:a:a:b:profile')).toBeNull()
    expect(healthProfileAccountId('m:health:a::profile')).toBeNull()
    expect(healthProfileAccountId('m:other:a:acc-1:profile')).toBeNull()
    expect(healthProfileAccountId('x:m:health:a:acc-1:profile')).toBeNull()
  })
})
