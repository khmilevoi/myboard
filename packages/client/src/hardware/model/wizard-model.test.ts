import { context } from '@reatom/core'
import {
  HARDWARE_EVENTS_KEY,
  type HardwareSnapshot,
  PAIRING_TTL_MS,
} from '@shared/hardware/board-api'
import { makeHardwareBoardClient } from '@shared/hardware/board-client'
import { COMMAND_FAILURE_REASONS } from '@shared/hardware/failure-reasons'
import type { BleAddress } from '@shared/hardware/models'
import {
  CONSENT_CODE_DIGITS,
  PAIRING_PIN_DIGITS,
  SCALE_ANSWER_TIMEOUT_MS,
  SCALE_USER_SLOTS,
  SCAN_DURATION_MS,
  type ScaleUserIndex,
} from '@shared/hardware/spike-assumptions'
import { makeFakeOpenEventStream } from '@shared/http/test/fake-event-stream'
import { makeScriptedHttp, type ScriptedStep } from '@shared/http/test/scripted-http'
import type { HealthModel } from 'module-health'
import type { Profile } from 'module-health/domain/profile'
import { makeTestHealthModel } from 'module-health/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GATEWAY_OFFLINE_COPY, GENERIC_ACTION_ERROR_COPY } from './hardware-copy'
import { makeHardwareModel } from './hardware-model'
import { makeWizardModel, PAIRING_ANSWER_CHECK_MS, WIZARD_OFFLINE_RETRY_MS } from './wizard-model'

const NOW = 1_800_000_000_000
const ADDRESS = 'AA:BB:CC:DD:EE:01' as BleAddress
const OTHER = 'AA:BB:CC:DD:EE:02' as BleAddress
const GOOD_PIN = '1'.repeat(PAIRING_PIN_DIGITS)
const TYPED_CODE = '3'.repeat(CONSENT_CODE_DIGITS)
const REVEALED_CODE = '5'.repeat(CONSENT_CODE_DIGITS)
const PROFILE: Profile = { heightCm: 182, birthDate: '1992-03-14', sex: 'male' }
const OFFLINE = { status: 409, body: { error: { code: 'gateway_offline', message: '' } } }

beforeEach(() =>
  vi.useFakeTimers({
    now: NOW,
    toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'],
  }),
)
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  context.reset()
})

type Gateway = HardwareSnapshot['gateways'][number]
type Hardware = HardwareSnapshot['hardware'][number]

const result = (address: BleAddress) => ({
  address,
  name: 'BF950',
  rssi: -60,
  model: 'beurer-bf950' as const,
})

const gateway = (patch: Partial<Gateway> = {}): Gateway => ({
  id: 'g1',
  label: 'Кухня',
  online: true,
  lastSeenAt: NOW,
  connectedAt: NOW,
  adapterPowered: true,
  scan: null,
  bondedNotAdopted: [],
  ...patch,
})

const scale = (patch: Partial<Hardware> = {}): Hardware => ({
  id: 'h1',
  gatewayId: 'g1',
  model: 'beurer-bf950',
  address: ADDRESS,
  battery: 80,
  lastReadingAt: null,
  profiles: [],
  ...patch,
})

const activeScan = (results: ReturnType<typeof result>[] = [], startedAt = Date.now()) => ({
  active: true,
  startedAt,
  results,
})

type SetupOptions = {
  scan?: ScriptedStep[]
  pair?: ScriptedStep[]
  pin?: ScriptedStep[]
  /** POST /api/hardware/items/h1/profiles */
  profiles?: ScriptedStep[]
  /** POST /api/hardware/items/h1/profiles/<index>/consent-code, keyed by index. */
  reveal?: Record<number, ScriptedStep[]>
  health?: () => Promise<HealthModel | Error>
  hasWeightCard?: boolean
}

function setup(options: SetupOptions) {
  // The snapshot endpoint always answers with whatever `server.snapshot` holds at request time.
  const server: { snapshot: HardwareSnapshot } = {
    snapshot: { gateways: [gateway()], hardware: [] },
  }
  const snapshotSteps: ScriptedStep[] = Array.from({ length: 50 }, () => ({
    status: 200,
    get body() {
      return server.snapshot
    },
  }))
  const { http, calls } = makeScriptedHttp({
    '/api/hardware': snapshotSteps,
    '/api/hardware/gateways/g1/scan': options.scan ?? [{ status: 202 }],
    '/api/hardware/gateways/g1/pairings': options.pair ?? [
      { status: 202, body: { pairingId: 'p1' } },
    ],
    '/api/hardware/pairings/p1/pin': options.pin ?? [{ status: 202 }],
    '/api/hardware/items/h1/profiles': options.profiles ?? [
      { status: 202, body: { commandId: 'c1' } },
    ],
    ...Object.fromEntries(
      Object.entries(options.reveal ?? {}).map(([index, steps]) => [
        `/api/hardware/items/h1/profiles/${index}/consent-code`,
        steps,
      ]),
    ),
  })
  const { open, streams } = makeFakeOpenEventStream()
  const client = makeHardwareBoardClient(http)
  const hardware = makeHardwareModel({ client, openEventStream: open, now: () => Date.now() })
  const model = makeWizardModel({
    hardware,
    client,
    health: options.health ?? (async () => new Error('no health model in this test')),
    hasWeightCard: () => options.hasWeightCard ?? false,
  })
  // The open dialog keeps these connected.
  hardware.snapshot.subscribe(() => {})
  model.scanning.subscribe(() => {})
  model.nothingFound.subscribe(() => {})
  model.healthProfile.subscribe(() => {})

  const snapshotGets = () => calls.filter((c) => c.method === 'GET' && c.url === '/api/hardware')
  const scanCalls = () => calls.filter((c) => c.url === '/api/hardware/gateways/g1/scan')
  const profileCalls = () => calls.filter((c) => c.url === '/api/hardware/items/h1/profiles')
  const loaded = () => vi.waitFor(() => expect(hardware.snapshot.data()).not.toBeNull())
  /** Server state changed: swap the snapshot and push a `changed` frame. */
  const change = async (snapshot: HardwareSnapshot) => {
    server.snapshot = snapshot
    const before = snapshotGets().length
    emit({ type: 'changed' })
    await vi.waitFor(() => expect(snapshotGets().length).toBeGreaterThan(before))
    await vi.waitFor(() => expect(hardware.snapshot.data()).toEqual(snapshot))
  }
  const emit = (value: unknown) => streams[0]!.emit(undefined, { key: HARDWARE_EVENTS_KEY, value })
  const flush = () => vi.advanceTimersByTimeAsync(0)
  /** Pushes a pairing frame for `p1` and lets the stream callback run. */
  const pairingFrame = async (stage: string, hardwareId: string | null = null) => {
    emit({ type: 'pairing', pairingId: 'p1', stage, hardwareId, reason: null })
    await flush()
  }
  /** Pushes the gateway's answer to command `c1`. */
  const commandFrame = async (ok: boolean, reason: string | null = null) => {
    emit({ type: 'command', commandId: 'c1', ok, reason })
    await flush()
  }
  return {
    model,
    hardware,
    server,
    calls,
    snapshotGets,
    scanCalls,
    profileCalls,
    commandFrame,
    loaded,
    change,
    emit,
    pairingFrame,
    flush,
  }
}

type Env = ReturnType<typeof setup>

/** Opens the scan with the gateway answering 202 and a scan record showing `results`. */
async function openScanning(env: Env, results = [result(ADDRESS)]) {
  await env.loaded()
  env.server.snapshot = { gateways: [gateway({ scan: activeScan(results) })], hardware: [] }
  await env.model.openScan('g1')
}

async function openPairing(env: Env) {
  await openScanning(env)
  await env.model.choose(ADDRESS)
}

describe('wizard scan', () => {
  it('openScan POSTs { action: start } and scanning is true while the snapshot scan is active within SCAN_DURATION_MS', async () => {
    const env = setup({})
    await openScanning(env)

    expect(env.scanCalls().map((c) => c.json)).toEqual([{ action: 'start' }])
    expect(env.model.step()).toEqual({ kind: 'scan' })
    expect(env.model.scanning()).toBe(true)
    expect(env.model.nothingFound()).toBe(false)
  })

  it('results come from the snapshot and hide an address already attached to this gateway', async () => {
    const env = setup({})
    await env.loaded()
    env.server.snapshot = {
      gateways: [gateway({ scan: activeScan([result(ADDRESS), result(OTHER)]) })],
      hardware: [scale({ address: ADDRESS })],
    }
    await env.model.openScan('g1')

    expect(env.model.results().map((r) => r.address)).toEqual([OTHER])
  })

  it('after SCAN_DURATION_MS with no results → nothingFound; rescan starts again', async () => {
    const env = setup({ scan: [{ status: 202 }, { status: 202 }] })
    await openScanning(env, [])
    expect(env.model.nothingFound()).toBe(false)

    await vi.advanceTimersByTimeAsync(SCAN_DURATION_MS + 1_000)
    expect(env.model.scanning()).toBe(false)
    expect(env.model.nothingFound()).toBe(true)

    env.server.snapshot = { gateways: [gateway({ scan: activeScan([]) })], hardware: [] }
    await env.model.rescan()
    expect(env.scanCalls()).toHaveLength(2)
    expect(env.model.scanning()).toBe(true)
    expect(env.model.nothingFound()).toBe(false)
  })

  it('a stale active scan record (not started by this run) never reports scanning', async () => {
    const env = setup({})
    env.server.snapshot = { gateways: [gateway({ scan: activeScan([]) })], hardware: [] }
    await env.loaded()
    env.model.gatewayId.set('g1')

    expect(env.model.scanning()).toBe(false)
    expect(env.model.nothingFound()).toBe(false)
  })

  it('409 gateway_offline on start → gatewayOffline true, scanning false; the gateway turning online starts a new scan by itself', async () => {
    const env = setup({
      scan: [
        { status: 409, body: { error: { code: 'gateway_offline', message: '' } } },
        { status: 202 },
      ],
    })
    await env.loaded()
    // The server wrote an active record although nothing is scanning (Review Focus 2).
    env.server.snapshot = {
      gateways: [gateway({ online: false, scan: activeScan([]) })],
      hardware: [],
    }
    await env.model.openScan('g1')
    await vi.waitFor(() => expect(env.hardware.snapshot.data()?.gateways[0]?.online).toBe(false))

    expect(env.model.gatewayOffline()).toBe(true)
    expect(env.model.scanning()).toBe(false)
    expect(env.model.nothingFound()).toBe(false)

    await env.change({ gateways: [gateway({ scan: activeScan([]) })], hardware: [] })
    await vi.waitFor(() => expect(env.scanCalls()).toHaveLength(2))
    await vi.waitFor(() => expect(env.model.scanning()).toBe(true))
    expect(env.model.gatewayOffline()).toBe(false)
  })

  it('close while scanning POSTs { action: stop } and a stop failure is only logged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const env = setup({ scan: [{ status: 202 }, { status: 500 }] })
    await openScanning(env)

    env.model.close()
    await env.flush()

    expect(env.scanCalls().map((c) => c.json)).toEqual([{ action: 'start' }, { action: 'stop' }])
    expect(warn).toHaveBeenCalledWith('Hardware scan stop failed:', expect.any(String))
    expect(env.model.step()).toEqual({ kind: 'scan' })
    expect(env.model.gatewayId()).toBeNull()
  })
})

describe('wizard pairing', () => {
  it('choose POSTs pairings and moves to pairing/connecting; pinEnabled false until a pairing frame pin_required', async () => {
    const env = setup({})
    await openScanning(env)
    const choseAt = Date.now()
    await env.model.choose(ADDRESS)

    const pairCall = env.calls.find((c) => c.url === '/api/hardware/gateways/g1/pairings')
    expect(pairCall?.json).toEqual({ address: ADDRESS })
    expect(env.model.step()).toMatchObject({
      kind: 'pairing',
      address: ADDRESS,
      pairingId: 'p1',
      stage: 'connecting',
      startedAt: choseAt,
    })
    env.model.pin.set(GOOD_PIN)
    expect(env.model.pinValid()).toBe(true)
    expect(env.model.pinEnabled()).toBe(false)

    await env.pairingFrame('pin_required')
    expect(env.model.step()).toMatchObject({ kind: 'pairing', stage: 'pin_required' })
    expect(env.model.pinEnabled()).toBe(true)

    await env.model.submitPin()
    const pinCall = env.calls.find((c) => c.url === '/api/hardware/pairings/p1/pin')
    expect(pinCall?.json).toEqual({ pin: GOOD_PIN })
  })

  it('pin_rejected keeps the pairing step with stage pin_rejected and clears the pin', async () => {
    const env = setup({})
    await openPairing(env)
    await env.pairingFrame('pin_required')
    env.model.pin.set(GOOD_PIN)
    await env.model.submitPin()

    await env.pairingFrame('pin_rejected')

    expect(env.model.step()).toMatchObject({ kind: 'pairing', stage: 'pin_rejected' })
    expect(env.model.pin()).toBe('')
    expect(env.model.pinEnabled()).toBe(true)
  })

  it('failed → pairingFailed', async () => {
    const env = setup({})
    await openPairing(env)

    await env.pairingFrame('failed')

    expect(env.model.step()).toEqual({ kind: 'pairingFailed' })
  })

  it('404 pairing_not_found on submitPin → pairingFailed', async () => {
    const env = setup({
      pin: [{ status: 404, body: { error: { code: 'pairing_not_found', message: '' } } }],
    })
    await openPairing(env)
    await env.pairingFrame('pin_required')
    env.model.pin.set(GOOD_PIN)

    await env.model.submitPin()

    expect(env.model.step()).toEqual({ kind: 'pairingFailed' })
  })

  it('bonded frame → profileChoice with that hardwareId', async () => {
    const env = setup({})
    await openPairing(env)

    await env.pairingFrame('bonded', 'h1')

    expect(env.model.step()).toEqual({ kind: 'profileChoice', hardwareId: 'h1', slotsFull: false })
  })

  it('a frame that beats the pair answer is still applied', async () => {
    const env = setup({})
    await openScanning(env)

    const choosing = env.model.choose(ADDRESS)
    // The frame arrives while the pair request is still in flight.
    env.emit({
      type: 'pairing',
      pairingId: 'p1',
      stage: 'pin_required',
      hardwareId: null,
      reason: null,
    })
    await choosing

    expect(env.model.step()).toMatchObject({ pairingId: 'p1', stage: 'pin_required' })
  })

  it('no bonded frame but the snapshot shows the hardware → profileChoice', async () => {
    const env = setup({})
    await openPairing(env)
    await env.pairingFrame('pin_required')
    env.model.pin.set(GOOD_PIN)
    await env.model.submitPin()

    await env.change({ gateways: [gateway()], hardware: [scale({ id: 'h7' })] })

    await vi.waitFor(() =>
      expect(env.model.step()).toEqual({
        kind: 'profileChoice',
        hardwareId: 'h7',
        slotsFull: false,
      }),
    )
  })

  it('no frame and no hardware after PAIRING_ANSWER_CHECK_MS → snapshot re-read; after PAIRING_TTL_MS with still nothing → pairingFailed', async () => {
    const env = setup({})
    await openPairing(env)
    await env.pairingFrame('pin_required')
    env.model.pin.set(GOOD_PIN)
    await env.model.submitPin()
    const before = env.snapshotGets().length

    await vi.advanceTimersByTimeAsync(PAIRING_ANSWER_CHECK_MS)
    expect(env.snapshotGets()).toHaveLength(before + 1)
    expect(env.model.step()).toMatchObject({ kind: 'pairing' })

    await vi.advanceTimersByTimeAsync(PAIRING_TTL_MS - PAIRING_ANSWER_CHECK_MS)
    await vi.waitFor(() => expect(env.model.step()).toEqual({ kind: 'pairingFailed' }))
    // One last read before giving up.
    expect(env.snapshotGets()).toHaveLength(before + 2)
  })

  it('the last read at PAIRING_TTL_MS finding the hardware → profileChoice', async () => {
    const env = setup({})
    await openPairing(env)
    // The server knows the hardware, but no frame said so and no refresh happened.
    env.server.snapshot = { gateways: [gateway()], hardware: [scale()] }

    await vi.advanceTimersByTimeAsync(PAIRING_TTL_MS)

    await vi.waitFor(() => expect(env.model.step()).toMatchObject({ kind: 'profileChoice' }))
  })

  it('404 scan_result_unknown on choose → back to scan and a fresh scan', async () => {
    const env = setup({
      scan: [{ status: 202 }, { status: 202 }],
      pair: [{ status: 404, body: { error: { code: 'scan_result_unknown', message: '' } } }],
    })
    await openScanning(env)

    await env.model.choose(ADDRESS)

    expect(env.model.step()).toEqual({ kind: 'scan' })
    expect(env.scanCalls().map((c) => c.json)).toEqual([{ action: 'start' }, { action: 'start' }])
    expect(env.model.scanning()).toBe(true)
  })

  it('gateway drop during pairing, then online → scan step with a fresh scan', async () => {
    const env = setup({ scan: [{ status: 202 }, { status: 202 }] })
    await openPairing(env)
    await env.pairingFrame('pin_required')
    env.model.pin.set(GOOD_PIN)

    await env.change({ gateways: [gateway({ online: false })], hardware: [] })
    await vi.waitFor(() => expect(env.model.step()).toEqual({ kind: 'scan' }))
    expect(env.model.gatewayOffline()).toBe(true)
    expect(env.model.pin()).toBe('')
    expect(env.scanCalls()).toHaveLength(1)

    await env.change({ gateways: [gateway({ scan: activeScan([]) })], hardware: [] })
    await vi.waitFor(() => expect(env.scanCalls()).toHaveLength(2))
    await vi.waitFor(() => expect(env.model.scanning()).toBe(true))
    expect(env.model.gatewayOffline()).toBe(false)
  })

  it('back from pairing returns to the scan step and stops the pairing waits', async () => {
    const env = setup({})
    await openPairing(env)

    env.model.back()
    // A late frame for the abandoned pairing changes nothing.
    await env.pairingFrame('bonded', 'h1')
    await vi.advanceTimersByTimeAsync(PAIRING_TTL_MS)

    expect(env.model.step()).toEqual({ kind: 'scan' })
  })
})

type Binding = Hardware['profiles'][number]['binding']
const bindings = (...entries: Array<[number, Binding]>): Hardware['profiles'] =>
  entries.map(([index, binding]) => ({ index: index as ScaleUserIndex, binding }))

/** A test health model, seeded with `profile` when given; `health` resolves once seeding is done. */
function healthWith(options: Parameters<typeof makeTestHealthModel>[0] = {}) {
  const test = makeTestHealthModel(options)
  return {
    ...test,
    health: async (): Promise<HealthModel | Error> => {
      const seeded = await test.ready
      if (seeded instanceof Error) return seeded
      return test.model
    },
  }
}

/** The wizard opened on the profile step of `h1` (the §2(c) entry). */
async function openProfileStep(env: Env, record: Hardware = scale()) {
  await env.loaded()
  await env.change({ gateways: [gateway()], hardware: [record] })
  await env.model.openProfile('h1')
}

/** create → writing with commandId c1 (health profile complete). */
async function startCreate(env: Env, record: Hardware = scale()) {
  await openProfileStep(env, record)
  await env.model.create()
  expect(env.model.step()).toMatchObject({ kind: 'writing', mode: 'create', commandId: 'c1' })
}

/** attach of index 2 with a typed code → writing. */
async function startAttach(env: Env) {
  await openProfileStep(env, scale({ profiles: bindings([1, 'other'], [2, 'none']) }))
  env.model.openAttach()
  env.model.selectIndex(2 as ScaleUserIndex)
  env.model.consent.set(TYPED_CODE)
  await env.model.attach()
}

describe('wizard profile choice', () => {
  it('profileChoice with profiles.length === SCALE_USER_SLOTS → create unavailable', async () => {
    const full = Array.from({ length: SCALE_USER_SLOTS }, (_, i): [number, Binding] => [
      i + 1,
      'other',
    ])
    const env = setup({ health: healthWith({ profile: PROFILE }).health })
    await openProfileStep(env, scale({ profiles: bindings(...full) }))

    expect(env.model.step()).toEqual({ kind: 'profileChoice', hardwareId: 'h1', slotsFull: true })
    await env.model.create()
    expect(env.profileCalls()).toHaveLength(0)
  })

  it('slotsFull from a scale_user_slots_full failure also disables create', async () => {
    const env = setup({ health: healthWith({ profile: PROFILE }).health })
    await startCreate(env)

    await env.commandFrame(false, COMMAND_FAILURE_REASONS.slotsFull)

    expect(env.model.step()).toEqual({ kind: 'profileChoice', hardwareId: 'h1', slotsFull: true })
    await env.model.create()
    expect(env.profileCalls()).toHaveLength(1)
  })

  it('the health profile shows once loaded; a missing one is null', async () => {
    const env = setup({ health: healthWith({ profile: PROFILE }).health })
    await openProfileStep(env)
    await vi.waitFor(() => expect(env.model.healthProfile()).toEqual(PROFILE))

    const empty = setup({ health: healthWith().health })
    await openProfileStep(empty)
    await empty.flush()
    expect(empty.model.healthProfile()).toBeNull()
  })

  it('create with no health profile → healthForm', async () => {
    const env = setup({ health: healthWith().health })
    await openProfileStep(env)

    await env.model.create()

    expect(env.model.step()).toEqual({ kind: 'healthForm', hardwareId: 'h1' })
    expect(env.profileCalls()).toHaveLength(0)
  })

  it('create with a complete profile POSTs { mode: create } → writing', async () => {
    const env = setup({ health: healthWith({ profile: PROFILE }).health })
    await startCreate(env)

    expect(env.profileCalls().map((c) => c.json)).toEqual([{ mode: 'create' }])
  })

  it('409 health_profile_missing → healthForm', async () => {
    const env = setup({
      health: healthWith({ profile: PROFILE }).health,
      profiles: [{ status: 409, body: { error: { code: 'health_profile_missing', message: '' } } }],
    })
    await openProfileStep(env)

    await env.model.create()

    expect(env.model.step()).toEqual({ kind: 'healthForm', hardwareId: 'h1' })
  })

  it('a create request failure that is no step shows actionError and keeps the step', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const env = setup({
      health: healthWith({ profile: PROFILE }).health,
      profiles: ['network-error', OFFLINE],
    })
    await openProfileStep(env)

    await env.model.create()
    expect(env.model.step()).toMatchObject({ kind: 'profileChoice' })
    expect(env.model.actionError()).toBe(GENERIC_ACTION_ERROR_COPY)
    expect(warn).toHaveBeenCalled()

    await env.model.create()
    expect(env.model.actionError()).toBe(GATEWAY_OFFLINE_COPY)

    env.model.openAttach()
    expect(env.model.actionError()).toBeNull()
  })

  it('back from healthForm and from attach → profileChoice', async () => {
    const env = setup({ health: healthWith().health })
    await openProfileStep(env)
    await env.model.create()
    env.model.back()
    expect(env.model.step()).toMatchObject({ kind: 'profileChoice', hardwareId: 'h1' })

    env.model.openAttach()
    expect(env.model.step()).toMatchObject({ kind: 'attach' })
    env.model.back()
    expect(env.model.step()).toMatchObject({ kind: 'profileChoice', hardwareId: 'h1' })
  })
})

describe('wizard health form', () => {
  it('saveHealthAndCreate calls health.setProfile with the parsed profile, then POSTs create', async () => {
    const test = healthWith()
    const env = setup({ health: test.health })
    await openProfileStep(env)
    await env.model.create()

    env.model.profileForm.set({ height: '182', birthDate: '14.03.1992', sex: 'male' })
    await env.model.saveHealthAndCreate()

    expect(test.calls).toEqual([{ action: 'setProfile', payload: PROFILE }])
    expect(env.profileCalls().map((c) => c.json)).toEqual([{ mode: 'create' }])
    expect(env.model.step()).toMatchObject({ kind: 'writing', mode: 'create' })
    expect(env.model.formError()).toBeNull()
  })

  it('an invalid field → formError for it, nothing saved', async () => {
    const test = healthWith()
    const env = setup({ health: test.health })
    await openProfileStep(env)
    await env.model.create()

    env.model.profileForm.set({ height: '99', birthDate: '14.03.1992', sex: 'male' })
    await env.model.saveHealthAndCreate()

    expect(env.model.formError()).toBe('height')
    expect(test.calls).toEqual([])
    expect(env.profileCalls()).toHaveLength(0)
  })

  it("setProfile failure → formError 'save', no POST", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const test = healthWith({ invoke: async () => new Error('module api down') })
    const env = setup({ health: test.health })
    await openProfileStep(env)
    await env.model.create()

    env.model.profileForm.set({ height: '182', birthDate: '14.03.1992', sex: 'male' })
    await env.model.saveHealthAndCreate()

    expect(env.model.formError()).toBe('save')
    expect(env.model.step()).toMatchObject({ kind: 'healthForm' })
    expect(env.profileCalls()).toHaveLength(0)
    expect(warn).toHaveBeenCalled()
  })
})

describe('wizard command answer', () => {
  it('command ok → done; index is the newly mine index; consentCode from the reveal POST', async () => {
    const env = setup({
      health: healthWith({ profile: PROFILE }).health,
      reveal: { 2: [{ status: 200, body: { consentCode: REVEALED_CODE } }] },
    })
    await startCreate(env, scale({ profiles: bindings([1, 'mine']) }))
    env.server.snapshot = {
      gateways: [gateway()],
      hardware: [scale({ profiles: bindings([1, 'mine'], [2, 'mine']) })],
    }

    await env.commandFrame(true)

    await vi.waitFor(() =>
      expect(env.model.step()).toEqual({
        kind: 'done',
        hardwareId: 'h1',
        index: 2,
        consentCode: REVEALED_CODE,
      }),
    )
  })

  it('attach lists only binding-none indexes as selectable; consentValid follows ConsentCodeSchema', async () => {
    const env = setup({})
    await openProfileStep(
      env,
      scale({ profiles: bindings([1, 'other'], [2, 'none'], [3, 'mine']) }),
    )
    env.model.openAttach()

    expect(env.model.attachIndexes()).toEqual([2])
    env.model.selectIndex(1 as ScaleUserIndex)
    expect(env.model.step()).toMatchObject({ kind: 'attach', index: null })
    env.model.selectIndex(2 as ScaleUserIndex)
    expect(env.model.step()).toMatchObject({ kind: 'attach', index: 2 })

    env.model.consent.set(TYPED_CODE.slice(1))
    expect(env.model.consentValid()).toBe(false)
    await env.model.attach()
    expect(env.profileCalls()).toHaveLength(0)

    env.model.consent.set(TYPED_CODE)
    expect(env.model.consentValid()).toBe(true)
    await env.model.attach()
    expect(env.profileCalls().map((c) => c.json)).toEqual([
      { mode: 'attach', index: 2, consentCode: TYPED_CODE },
    ])
    expect(env.model.step()).toMatchObject({ kind: 'writing', mode: 'attach' })
  })

  it('attach ok → done with the attached index and the typed code', async () => {
    const env = setup({})
    await startAttach(env)

    await env.commandFrame(true)

    await vi.waitFor(() =>
      expect(env.model.step()).toEqual({
        kind: 'done',
        hardwareId: 'h1',
        index: 2,
        consentCode: TYPED_CODE,
      }),
    )
  })

  it("command consent_rejected on attach → attach with error 'consent'", async () => {
    const env = setup({})
    await startAttach(env)

    await env.commandFrame(false, COMMAND_FAILURE_REASONS.consentRejected)

    expect(env.model.step()).toEqual({
      kind: 'attach',
      hardwareId: 'h1',
      index: 2,
      error: 'consent',
    })
    expect(env.model.consent()).toBe('')
  })

  it("409 scale_profile_bound on attach → error 'bound'", async () => {
    const env = setup({
      profiles: [{ status: 409, body: { error: { code: 'scale_profile_bound', message: '' } } }],
    })
    await startAttach(env)

    expect(env.model.step()).toMatchObject({ kind: 'attach', hardwareId: 'h1', error: 'bound' })
  })

  it('command with another reason → scaleSilent; retry re-sends the same mode; back → profileChoice', async () => {
    const env = setup({
      profiles: [
        { status: 202, body: { commandId: 'c1' } },
        { status: 202, body: { commandId: 'c2' } },
      ],
    })
    await startAttach(env)

    await env.commandFrame(false, 'scale_not_found')
    expect(env.model.step()).toEqual({ kind: 'scaleSilent', hardwareId: 'h1', mode: 'attach' })

    await env.model.retry()
    const bodies = env.profileCalls().map((c) => c.json)
    expect(bodies).toHaveLength(2)
    expect(bodies[1]).toEqual(bodies[0])
    expect(env.model.step()).toMatchObject({ kind: 'writing', mode: 'attach', commandId: 'c2' })

    env.emit({ type: 'command', commandId: 'c2', ok: false, reason: 'scale_not_found' })
    await env.flush()
    expect(env.model.step()).toMatchObject({ kind: 'scaleSilent' })
    env.model.back()
    expect(env.model.step()).toMatchObject({ kind: 'profileChoice', hardwareId: 'h1' })
  })

  it('no command frame within SCALE_ANSWER_TIMEOUT_MS but a new mine binding in the re-read snapshot → done', async () => {
    const env = setup({
      health: healthWith({ profile: PROFILE }).health,
      reveal: { 1: [{ status: 200, body: { consentCode: REVEALED_CODE } }] },
    })
    await startCreate(env)
    // The binding was written, the `command` publish was lost (Review Focus 3).
    env.server.snapshot = {
      gateways: [gateway()],
      hardware: [scale({ profiles: bindings([1, 'mine']) })],
    }

    await vi.advanceTimersByTimeAsync(SCALE_ANSWER_TIMEOUT_MS - 1_000)
    expect(env.model.step()).toMatchObject({ kind: 'writing' })
    await vi.advanceTimersByTimeAsync(1_000)

    await vi.waitFor(() =>
      expect(env.model.step()).toEqual({
        kind: 'done',
        hardwareId: 'h1',
        index: 1,
        consentCode: REVEALED_CODE,
      }),
    )
  })

  it('…and none → scaleSilent', async () => {
    const env = setup({ health: healthWith({ profile: PROFILE }).health })
    await startCreate(env)

    await vi.advanceTimersByTimeAsync(SCALE_ANSWER_TIMEOUT_MS)

    await vi.waitFor(() =>
      expect(env.model.step()).toEqual({ kind: 'scaleSilent', hardwareId: 'h1', mode: 'create' }),
    )
  })

  it('done with no weight card → boardNeedsWeightCard true', async () => {
    const env = setup({})
    await startAttach(env)
    expect(env.model.boardNeedsWeightCard()).toBe(false)

    await env.commandFrame(true)

    await vi.waitFor(() => expect(env.model.step()).toMatchObject({ kind: 'done' }))
    expect(env.model.boardNeedsWeightCard()).toBe(true)
  })

  it('done with a weight card → boardNeedsWeightCard false', async () => {
    const env = setup({ hasWeightCard: true })
    await startAttach(env)

    await env.commandFrame(true)

    await vi.waitFor(() => expect(env.model.step()).toMatchObject({ kind: 'done' }))
    expect(env.model.boardNeedsWeightCard()).toBe(false)
  })
})

describe('wizard recovery (Task 10 follow-ups)', () => {
  it('409 gateway_offline while the snapshot still says online → one retry after WIZARD_OFFLINE_RETRY_MS', async () => {
    const env = setup({ scan: [OFFLINE, { status: 202 }] })
    await env.loaded()
    env.server.snapshot = { gateways: [gateway({ scan: activeScan([]) })], hardware: [] }
    await env.model.openScan('g1')
    expect(env.model.gatewayOffline()).toBe(true)
    expect(env.model.scanning()).toBe(false)

    await vi.advanceTimersByTimeAsync(WIZARD_OFFLINE_RETRY_MS)

    await vi.waitFor(() => expect(env.scanCalls()).toHaveLength(2))
    await vi.waitFor(() => expect(env.model.scanning()).toBe(true))
    expect(env.model.gatewayOffline()).toBe(false)
  })

  it('the retry refused too while online → no spinner, rescan offered (nothingFound)', async () => {
    const env = setup({ scan: [OFFLINE, OFFLINE, { status: 202 }] })
    await env.loaded()
    // A stale active record from the refused start (Review Focus 2) must not spin.
    env.server.snapshot = { gateways: [gateway({ scan: activeScan([]) })], hardware: [] }
    await env.model.openScan('g1')

    await vi.advanceTimersByTimeAsync(WIZARD_OFFLINE_RETRY_MS)
    await vi.waitFor(() => expect(env.scanCalls()).toHaveLength(2))
    await vi.waitFor(() => expect(env.model.gatewayOffline()).toBe(false))
    expect(env.model.scanning()).toBe(false)
    expect(env.model.nothingFound()).toBe(true)

    await vi.advanceTimersByTimeAsync(WIZARD_OFFLINE_RETRY_MS * 3)
    expect(env.scanCalls()).toHaveLength(2)
    await env.model.rescan()
    expect(env.scanCalls()).toHaveLength(3)
  })

  it('the auto-restart scan refused while online → retried once', async () => {
    const env = setup({ scan: [OFFLINE, OFFLINE, { status: 202 }] })
    await env.loaded()
    env.server.snapshot = { gateways: [gateway({ online: false })], hardware: [] }
    await env.model.openScan('g1')
    await vi.waitFor(() => expect(env.hardware.snapshot.data()?.gateways[0]?.online).toBe(false))

    await env.change({ gateways: [gateway({ scan: activeScan([]) })], hardware: [] })
    await vi.waitFor(() => expect(env.scanCalls()).toHaveLength(2))
    expect(env.model.gatewayOffline()).toBe(true)

    await vi.advanceTimersByTimeAsync(WIZARD_OFFLINE_RETRY_MS)
    await vi.waitFor(() => expect(env.scanCalls()).toHaveLength(3))
    await vi.waitFor(() => expect(env.model.scanning()).toBe(true))
  })

  it('submitPin 409 pairing_not_waiting_pin → actionError, step unchanged', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const env = setup({
      pin: [{ status: 409, body: { error: { code: 'pairing_not_waiting_pin', message: '' } } }],
    })
    await openPairing(env)
    await env.pairingFrame('pin_required')
    env.model.pin.set(GOOD_PIN)

    await env.model.submitPin()

    expect(env.model.step()).toMatchObject({ kind: 'pairing', stage: 'pin_required' })
    expect(env.model.actionError()).toBe(GENERIC_ACTION_ERROR_COPY)
  })

  it('back from pairing drops the buffered frames', async () => {
    const env = setup({
      pair: [
        { status: 202, body: { pairingId: 'p1' } },
        { status: 202, body: { pairingId: 'p1' } },
      ],
    })
    await openPairing(env)
    await env.pairingFrame('pin_required')

    env.model.back()
    await env.model.choose(ADDRESS)

    expect(env.model.step()).toMatchObject({ kind: 'pairing', stage: 'connecting' })
  })

  it('dispose stops listening to board events', async () => {
    const env = setup({})
    await env.loaded()
    env.model.dispose()
    await openPairing(env)

    await env.pairingFrame('pin_required')

    expect(env.model.step()).toMatchObject({ kind: 'pairing', stage: 'connecting' })
  })

  it('pair 409 gateway_offline while the snapshot still says online → one scan retry, then rescan offered', async () => {
    const env = setup({
      scan: [{ status: 202 }, OFFLINE, { status: 202 }],
      pair: [OFFLINE],
    })
    await openScanning(env)

    await env.model.choose(ADDRESS)
    expect(env.model.step()).toEqual({ kind: 'scan' })
    expect(env.model.gatewayOffline()).toBe(true)

    await vi.advanceTimersByTimeAsync(WIZARD_OFFLINE_RETRY_MS)
    await vi.waitFor(() => expect(env.scanCalls()).toHaveLength(2))
    // The retried scan was refused too: no endless offline state, «Искать снова» instead.
    await vi.waitFor(() => expect(env.model.gatewayOffline()).toBe(false))
    expect(env.model.scanning()).toBe(false)

    await vi.advanceTimersByTimeAsync(WIZARD_OFFLINE_RETRY_MS * 3)
    expect(env.scanCalls()).toHaveLength(2)
    await env.model.rescan()
    expect(env.scanCalls()).toHaveLength(3)
  })
})
