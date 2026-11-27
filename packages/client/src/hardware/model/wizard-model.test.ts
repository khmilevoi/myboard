import { context } from '@reatom/core'
import {
  HARDWARE_EVENTS_KEY,
  type HardwareSnapshot,
  PAIRING_TTL_MS,
} from '@shared/hardware/board-api'
import { makeHardwareBoardClient } from '@shared/hardware/board-client'
import type { BleAddress } from '@shared/hardware/models'
import { PAIRING_PIN_DIGITS, SCAN_DURATION_MS } from '@shared/hardware/spike-assumptions'
import { makeFakeOpenEventStream } from '@shared/http/test/fake-event-stream'
import { makeScriptedHttp, type ScriptedStep } from '@shared/http/test/scripted-http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { makeHardwareModel } from './hardware-model'
import { makeWizardModel, PAIRING_ANSWER_CHECK_MS } from './wizard-model'

const NOW = 1_800_000_000_000
const ADDRESS = 'AA:BB:CC:DD:EE:01' as BleAddress
const OTHER = 'AA:BB:CC:DD:EE:02' as BleAddress
const GOOD_PIN = '1'.repeat(PAIRING_PIN_DIGITS)

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

function setup(options: { scan?: ScriptedStep[]; pair?: ScriptedStep[]; pin?: ScriptedStep[] }) {
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
  })
  const { open, streams } = makeFakeOpenEventStream()
  const client = makeHardwareBoardClient(http)
  const hardware = makeHardwareModel({ client, openEventStream: open, now: () => Date.now() })
  const model = makeWizardModel({
    hardware,
    client,
    health: async () => new Error('unused'),
    hasWeightCard: () => false,
  })
  // The open dialog keeps these connected.
  hardware.snapshot.subscribe(() => {})
  model.scanning.subscribe(() => {})
  model.nothingFound.subscribe(() => {})

  const snapshotGets = () => calls.filter((c) => c.method === 'GET' && c.url === '/api/hardware')
  const scanCalls = () => calls.filter((c) => c.url === '/api/hardware/gateways/g1/scan')
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
  return {
    model,
    hardware,
    server,
    calls,
    snapshotGets,
    scanCalls,
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
