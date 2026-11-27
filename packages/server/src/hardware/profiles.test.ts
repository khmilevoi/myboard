import { PROFILE_KEY } from '@modules/health/domain/keys'
import type { Profile } from '@modules/health/domain/profile'
import { HARDWARE_EVENTS_KEY, type HardwareSnapshot } from '@shared/hardware/board-api'
import type { GatewayCommand, GatewayEvent } from '@shared/hardware/gateway-protocol'
import { makeFakeGateway, type FakeGateway } from '@shared/hardware/testing/fake-gateway'
import { CSRF_HEADER, CSRF_HEADER_VALUE } from '@shared/http/csrf'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { openSse, startTestApp, type OpenSse, type TestApp } from '../test/app-fixture'
import { healthStorageFor } from './health-access'

let app: TestApp | undefined
const cleanups: (() => void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  vi.restoreAllMocks()
  await app?.close()
  app = undefined
})

const ADDRESS = 'AA:BB:CC:DD:EE:01'
const PROFILE_A: Profile = { heightCm: 181, birthDate: '1990-04-12', sex: 'male' }

/** Every body a browser received in this test, except the owner-only reveal endpoint's. */
let browserBodies: string[] = []

async function board(
  path: string,
  method: string,
  cookie: string,
  body?: unknown,
): Promise<{ status: number; headers: Headers; text: string }> {
  const res = await fetch(`${app!.base}${path}`, {
    method,
    headers: {
      [CSRF_HEADER]: CSRF_HEADER_VALUE,
      cookie,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await res.text()
  if (!path.endsWith('/consent-code')) browserBodies.push(text)
  return { status: res.status, headers: res.headers, text }
}

const json = <T>(res: { text: string }) => JSON.parse(res.text) as T

async function snapshot(cookie: string): Promise<HardwareSnapshot> {
  const res = await board('/api/hardware', 'GET', cookie)
  expect(res.status).toBe(200)
  return json<HardwareSnapshot>(res)
}

/** Drains a board SSE stream into `frames` (all recorded) and lets a test wait for one. */
type BoardFrames = {
  frames: string[]
  /** The next frame of `type` (and of `commandId`, when given); earlier ones are dropped. */
  next(type: string, commandId?: string): Promise<Record<string, unknown>>
}

async function boardFrames(cookie: string): Promise<BoardFrames> {
  const sse: OpenSse = await openSse(app!.base, cookie, '/api/hardware/events')
  cleanups.push(sse.close)
  const frames: string[] = []
  const queue: Record<string, unknown>[] = []
  const waiter: { wake: (() => void) | null } = { wake: null }
  void (async () => {
    for (;;) {
      const frame = await sse.nextFrame().catch(() => null)
      if (frame === null) return
      frames.push(JSON.stringify(frame))
      if (frame.key !== HARDWARE_EVENTS_KEY) continue
      queue.push(frame.value as Record<string, unknown>)
      waiter.wake?.()
    }
  })()
  return {
    frames,
    async next(type, commandId) {
      for (;;) {
        const at = queue.findIndex(
          (value) =>
            value.type === type && (commandId === undefined || value.commandId === commandId),
        )
        if (at >= 0) return queue.splice(0, at + 1)[at]!
        await new Promise<void>((resolve) => {
          waiter.wake = resolve
        })
      }
    },
  }
}

async function post(gateway: FakeGateway, ...events: GatewayEvent[]) {
  const res = await gateway.postEvents(events)
  expect(res.status).toBe(204)
}

async function register(cookie: string): Promise<FakeGateway> {
  const res = await board('/api/hardware/codes', 'POST', cookie)
  const { code } = json<{ code: string }>(res)
  const gateway = makeFakeGateway(app!.base)
  await gateway.register(code, 'Hall')
  return gateway
}

async function setup() {
  browserBodies = []
  app = await startTestApp()
  const a = await app.seedSession('Ann')
  const b = await app.seedSession('Bob')
  const gateway = await register(a.cookie)
  const stream = await gateway.openStream()
  cleanups.push(stream.close)
  // The open-time sync, so later assertions see only the syncs their own action caused.
  await stream.nextCommand('bindings.sync')
  await post(gateway, { type: 'bonded', hardware: [{ address: ADDRESS, model: 'beurer-bf950' }] })
  const adopted = await board(
    `/api/hardware/gateways/${gateway.gatewayId}/adopt`,
    'POST',
    a.cookie,
    { address: ADDRESS },
  )
  expect(adopted.status).toBe(200)
  const { hardwareId } = json<{ hardwareId: string }>(adopted)
  await stream.nextCommand('bindings.sync')
  await post(gateway, { type: 'scaleUsers', hardwareId, users: [{ index: 1 }, { index: 2 }] })
  return { a, b, gateway, stream, hardwareId }
}

const profilesPath = (hardwareId: string) => `/api/hardware/items/${hardwareId}/profiles`

describe('scale profiles', () => {
  it('creates, attaches, reveals and unbinds without leaking a consent code', async () => {
    const { a, b, gateway, stream, hardwareId } = await setup()
    const logs = [
      vi.spyOn(console, 'error'),
      vi.spyOn(console, 'warn'),
      vi.spyOn(console, 'log'),
      vi.spyOn(console, 'info'),
    ]
    const framesA = await boardFrames(a.cookie)
    const framesB = await boardFrames(b.cookie)

    // No health profile yet.
    const missing = await board(profilesPath(hardwareId), 'POST', a.cookie, { mode: 'create' })
    expect(missing.status).toBe(409)
    expect(json(missing)).toEqual({
      error: { code: 'health_profile_missing', message: 'Health profile is missing' },
    })

    expect(
      await healthStorageFor(app!.ops, Date.now, a.accountId).set(PROFILE_KEY, PROFILE_A),
    ).toBeUndefined()
    const created = await board(profilesPath(hardwareId), 'POST', a.cookie, { mode: 'create' })
    expect(created.status).toBe(202)
    const { commandId } = json<{ commandId: string }>(created)
    const create = (await stream.nextCommand('scaleUser.create')) as Extract<
      GatewayCommand,
      { type: 'scaleUser.create' }
    >
    expect(create).toMatchObject({
      id: commandId,
      hardwareId,
      address: ADDRESS,
      profile: { heightCm: 181, birthDate: '1990-04-12', sex: 'male' },
    })
    expect(create.consentCode).toMatch(/^\d{4}$/)
    const consentCode = create.consentCode

    await post(gateway, { type: 'scaleUser.created', commandId, index: 3 })
    expect(await framesA.next('command', commandId)).toEqual({
      type: 'command',
      commandId,
      ok: true,
      reason: null,
    })
    expect(await stream.nextCommand('bindings.sync')).toMatchObject({
      bindings: [{ hardwareId, address: ADDRESS, index: 3, consentCode }],
    })
    expect((await snapshot(a.cookie)).hardware[0]?.profiles).toEqual([
      { index: 1, binding: 'none' },
      { index: 2, binding: 'none' },
      { index: 3, binding: 'mine' },
    ])
    expect((await snapshot(b.cookie)).hardware[0]?.profiles).toContainEqual({
      index: 3,
      binding: 'other',
    })
    // A repeated `created` (the gateway resends a batch) changes nothing.
    await post(gateway, { type: 'scaleUser.created', commandId, index: 3 })

    // Only the owner may reveal the code, and it is never cached.
    const revealed = await board(`${profilesPath(hardwareId)}/3/consent-code`, 'POST', a.cookie)
    expect(revealed.status).toBe(200)
    expect(revealed.headers.get('cache-control')).toBe('no-store')
    expect(json(revealed)).toEqual({ consentCode })
    const foreign = await board(`${profilesPath(hardwareId)}/3/consent-code`, 'POST', b.cookie)
    expect(foreign.status).toBe(403)
    expect(json(foreign)).toEqual({
      error: { code: 'not_binding_owner', message: 'Only the binding owner can do this' },
    })
    browserBodies.push(foreign.text)

    // Attach: a bound index is refused, an unknown one too, a bad one is invalid.
    const bound = await board(profilesPath(hardwareId), 'POST', b.cookie, {
      mode: 'attach',
      index: 3,
      consentCode: '1234',
    })
    expect(bound.status).toBe(409)
    expect(json<{ error: { code: string } }>(bound).error.code).toBe('scale_profile_bound')
    const unknown = await board(profilesPath(hardwareId), 'POST', b.cookie, {
      mode: 'attach',
      index: 5,
      consentCode: '1234',
    })
    expect(unknown.status).toBe(404)
    expect(json<{ error: { code: string } }>(unknown).error.code).toBe('scale_profile_unknown')
    const invalid = await board(profilesPath(hardwareId), 'POST', b.cookie, {
      mode: 'attach',
      index: 9,
      consentCode: '1234',
    })
    expect(invalid.status).toBe(422)

    const attached = await board(profilesPath(hardwareId), 'POST', b.cookie, {
      mode: 'attach',
      index: 1,
      consentCode: '1234',
    })
    expect(attached.status).toBe(202)
    const attachId = json<{ commandId: string }>(attached).commandId
    expect(await stream.nextCommand('scaleUser.attach')).toMatchObject({
      id: attachId,
      hardwareId,
      address: ADDRESS,
      index: 1,
      consentCode: '1234',
    })
    await post(gateway, { type: 'command.failed', commandId: attachId, reason: 'consent_rejected' })
    expect(await framesB.next('command', attachId)).toEqual({
      type: 'command',
      commandId: attachId,
      ok: false,
      reason: 'consent_rejected',
    })
    expect((await snapshot(b.cookie)).hardware[0]?.profiles).toContainEqual({
      index: 1,
      binding: 'none',
    })
    // The failed command is gone: a late `attached` for it binds nothing.
    await post(gateway, { type: 'scaleUser.attached', commandId: attachId })
    expect((await snapshot(b.cookie)).hardware[0]?.profiles).toContainEqual({
      index: 1,
      binding: 'none',
    })

    // Unbind: only the owner.
    const foreignUnbind = await board(`${profilesPath(hardwareId)}/3`, 'DELETE', b.cookie)
    expect(foreignUnbind.status).toBe(403)
    const unbound = await board(`${profilesPath(hardwareId)}/3`, 'DELETE', a.cookie)
    expect(unbound.status).toBe(204)
    expect(await stream.nextCommand('bindings.sync')).toMatchObject({ bindings: [] })
    expect((await snapshot(a.cookie)).hardware[0]?.profiles).toContainEqual({
      index: 3,
      binding: 'none',
    })
    const gone = await board(`${profilesPath(hardwareId)}/3`, 'DELETE', a.cookie)
    expect(gone.status).toBe(404)
    expect(json<{ error: { code: string } }>(gone).error.code).toBe('binding_not_found')

    await framesA.next('changed')
    await framesB.next('changed')
    const seen = [...browserBodies, ...framesA.frames, ...framesB.frames]
    expect(seen.length).toBeGreaterThan(10)
    // A standalone token: the code may legitimately occur inside a longer number (a timestamp).
    const leak = new RegExp(`(?<![0-9A-Za-z])${consentCode}(?![0-9A-Za-z])`)
    for (const body of seen) expect(body).not.toMatch(leak)
    expect(framesA.frames.length).toBeGreaterThan(0)
    expect(framesB.frames.length).toBeGreaterThan(0)
    for (const log of logs) expect(JSON.stringify(log.mock.calls)).not.toMatch(leak)
  })

  it('attaches an existing scale profile once the scale confirms the code', async () => {
    const { b, gateway, stream, hardwareId } = await setup()
    const framesB = await boardFrames(b.cookie)
    const attached = await board(profilesPath(hardwareId), 'POST', b.cookie, {
      mode: 'attach',
      index: 2,
      consentCode: '0007',
    })
    expect(attached.status).toBe(202)
    const { commandId } = json<{ commandId: string }>(attached)
    await stream.nextCommand('scaleUser.attach')

    await post(gateway, { type: 'scaleUser.attached', commandId })
    expect(await framesB.next('command', commandId)).toMatchObject({ ok: true })
    expect(await stream.nextCommand('bindings.sync')).toMatchObject({
      bindings: [{ hardwareId, index: 2, consentCode: '0007' }],
    })
    expect((await snapshot(b.cookie)).hardware[0]?.profiles).toContainEqual({
      index: 2,
      binding: 'mine',
    })
  })

  it('fails a command whose index was bound meanwhile, and ignores another gateway’s reply', async () => {
    const { a, b, gateway, hardwareId } = await setup()
    const framesA = await boardFrames(a.cookie)
    for (const session of [a, b]) {
      expect(
        await healthStorageFor(app!.ops, Date.now, session.accountId).set(PROFILE_KEY, PROFILE_A),
      ).toBeUndefined()
    }
    const first = json<{ commandId: string }>(
      await board(profilesPath(hardwareId), 'POST', a.cookie, { mode: 'create' }),
    ).commandId
    const second = json<{ commandId: string }>(
      await board(profilesPath(hardwareId), 'POST', b.cookie, { mode: 'create' }),
    ).commandId

    const stranger = await register(a.cookie)
    await post(stranger, { type: 'scaleUser.created', commandId: first, index: 4 })
    expect((await snapshot(a.cookie)).hardware[0]?.profiles).not.toContainEqual({
      index: 4,
      binding: 'mine',
    })

    await post(gateway, { type: 'scaleUser.created', commandId: second, index: 4 })
    await post(gateway, { type: 'scaleUser.created', commandId: first, index: 4 })
    expect(await framesA.next('command', second)).toMatchObject({ ok: true })
    expect(await framesA.next('command', first)).toEqual({
      type: 'command',
      commandId: first,
      ok: false,
      reason: 'scale_profile_bound',
    })
    expect((await snapshot(a.cookie)).hardware[0]?.profiles).toContainEqual({
      index: 4,
      binding: 'other',
    })
  })

  it('requires the gateway online to create or attach, but not to unbind or reveal', async () => {
    const { a, stream, gateway, hardwareId } = await setup()
    expect(
      await healthStorageFor(app!.ops, Date.now, a.accountId).set(PROFILE_KEY, PROFILE_A),
    ).toBeUndefined()
    const commandId = json<{ commandId: string }>(
      await board(profilesPath(hardwareId), 'POST', a.cookie, { mode: 'create' }),
    ).commandId
    await post(gateway, { type: 'scaleUser.created', commandId, index: 3 })

    stream.close()
    for (;;) {
      if (!(await snapshot(a.cookie)).gateways[0]?.online) break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    for (const body of [{ mode: 'create' }, { mode: 'attach', index: 1, consentCode: '1234' }]) {
      const res = await board(profilesPath(hardwareId), 'POST', a.cookie, body)
      expect(res.status).toBe(409)
      expect(json<{ error: { code: string } }>(res).error.code).toBe('gateway_offline')
    }
    expect(
      (await board(`${profilesPath(hardwareId)}/3/consent-code`, 'POST', a.cookie)).status,
    ).toBe(200)
    expect((await board(`${profilesPath(hardwareId)}/3`, 'DELETE', a.cookie)).status).toBe(204)
  })

  it('answers 404 for unknown hardware', async () => {
    const { a } = await setup()
    const res = await board(profilesPath('nope'), 'POST', a.cookie, { mode: 'create' })
    expect(res.status).toBe(404)
    expect((await board(`${profilesPath('nope')}/1`, 'DELETE', a.cookie)).status).toBe(404)
    expect((await board(`${profilesPath('nope')}/1/consent-code`, 'POST', a.cookie)).status).toBe(
      404,
    )
  })
})
