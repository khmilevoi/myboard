import {
  action,
  type Action,
  addCallHook,
  atom,
  type Atom,
  type AtomLike,
  type Computed,
  computed,
  isAbort,
  sleep,
  take,
  withAbort,
  withAsync,
  wrap,
} from '@reatom/core'
import {
  type HardwareBoardEvent,
  PAIRING_TTL_MS,
  type PairingStage,
  type ScanResult,
} from '@shared/hardware/board-api'
import { type HardwareBoardClient, isHardwareError } from '@shared/hardware/board-client'
import type { BleAddress } from '@shared/hardware/models'
import {
  PairingPinSchema,
  SCALE_USER_SLOTS,
  SCAN_DURATION_MS,
  type ScaleUserIndex,
} from '@shared/hardware/spike-assumptions'
import type { HealthModel } from 'module-health'
import { makeTickingNow } from 'widget-sdk/reatom/countdown'

import type { HardwareModel } from './hardware-model'

/** After a PIN is submitted with no answer for this long, the wizard re-reads the snapshot (Decision 7). */
export const PAIRING_ANSWER_CHECK_MS = 20_000

export type WizardStep =
  | { kind: 'scan' }
  | {
      kind: 'pairing'
      address: BleAddress
      pairingId: string | null
      stage: PairingStage
      startedAt: number
    }
  | { kind: 'pairingFailed' }
  | { kind: 'profileChoice'; hardwareId: string; slotsFull: boolean }
  | { kind: 'healthForm'; hardwareId: string }
  | {
      kind: 'attach'
      hardwareId: string
      index: ScaleUserIndex | null
      error: 'consent' | 'bound' | null
    }
  | { kind: 'writing'; hardwareId: string; mode: 'create' | 'attach'; commandId: string }
  | { kind: 'scaleSilent'; hardwareId: string; mode: 'create' | 'attach' }
  | { kind: 'done'; hardwareId: string; index: ScaleUserIndex; consentCode: string | null }

type PairingStep = Extract<WizardStep, { kind: 'pairing' }>
type PairingFrame = Extract<HardwareBoardEvent, { type: 'pairing' }>
type CommandFrame = Extract<HardwareBoardEvent, { type: 'command' }>

export type WizardModel = {
  step: Atom<WizardStep>
  gatewayId: Atom<string | null>
  /** §4(e): the gateway is offline, or this run's last scan start was refused as offline. */
  gatewayOffline: Computed<boolean>
  /** Decision 6: this run got a 202 and the snapshot's scan is active inside its window. */
  scanning: Computed<boolean>
  /** This gateway's scan results minus addresses already attached to it. */
  results: Computed<ScanResult[]>
  /** §4(a2): this run's scan finished with nothing to show. */
  nothingFound: Computed<boolean>
  pin: Atom<string>
  pinValid: Computed<boolean>
  /** Decision 8: «Сопрячь» may be pressed only once the gateway asks for the PIN. */
  pinEnabled: Computed<boolean>
  openScan: Action<[gatewayId: string], Promise<void>>
  rescan: Action<[], Promise<void>>
  choose: Action<[address: BleAddress], Promise<void>>
  submitPin: Action<[], Promise<void>>
  /** pairing → scan; healthForm/attach → profileChoice. */
  back: Action<[], void>
  /** Best-effort scan stop, aborts every wait, resets the wizard. */
  close: Action<[], void>
}

export type WizardDeps = {
  hardware: HardwareModel
  client: HardwareBoardClient
  /** Task 11: the account's health model for the create flow. */
  health: () => Promise<HealthModel | Error>
  /** Task 11: whether the board already shows a weight card. */
  hasWeightCard: () => boolean
}

const SCAN_TICK_MS = 1_000
// Recent pairing/command frames kept so a frame that beats its HTTP answer is not lost.
const RECENT_EVENTS_LIMIT = 20

/** Fire-and-forget launcher for the abortable waits: an abort is expected, anything else is logged. */
function launch(promise: Promise<unknown>, what: string) {
  promise.catch((cause: unknown) => {
    if (isAbort(cause)) return
    console.warn(`Hardware wizard ${what} failed:`, cause)
  })
}

export function makeWizardModel(deps: WizardDeps): WizardModel {
  const { hardware, client } = deps

  const step = atom<WizardStep>({ kind: 'scan' }, 'hardware.wizard.step')
  const gatewayId = atom<string | null>(null, 'hardware.wizard.gatewayId')
  const pin = atom('', 'hardware.wizard.pin')
  // Bumped by openScan/close: an answer that lands after the run changed is dropped.
  const session = atom(0, 'hardware.wizard.session')

  // Decision 6: "scanning" requires a 202 from this run; `starting` covers the request and the re-read.
  const scanStarting = atom(false, 'hardware.wizard.scanStarting')
  const scanAccepted = atom(false, 'hardware.wizard.scanAccepted')
  // Set when the gateway was offline for a scan start or dropped mid-scan/pairing: restart on online.
  const restartOnOnline = atom(false, 'hardware.wizard.restartOnOnline')

  const recentEvents = atom<Array<PairingFrame | CommandFrame>>([], 'hardware.wizard.recentEvents')

  const scanClock = makeTickingNow({
    now: hardware.now,
    intervalMs: SCAN_TICK_MS,
    name: 'hardware.wizard.scanClock',
  })

  const gateway = computed(() => {
    const id = gatewayId()
    if (id === null) return null
    return hardware.snapshot.data()?.gateways.find((g) => g.id === id) ?? null
  }, 'hardware.wizard.gateway')

  const gatewayOnline = computed(() => gateway()?.online ?? null, 'hardware.wizard.gatewayOnline')

  const gatewayOffline = computed(
    () => restartOnOnline() || gatewayOnline() === false,
    'hardware.wizard.gatewayOffline',
  )

  const scanning = computed(() => {
    if (scanStarting()) return true
    if (!scanAccepted()) return false
    const scan = gateway()?.scan ?? null
    if (scan === null || !scan.active) return false
    return scanClock() < scan.startedAt + SCAN_DURATION_MS
  }, 'hardware.wizard.scanning')

  const results = computed(() => {
    const id = gatewayId()
    const scan = gateway()?.scan ?? null
    if (id === null || scan === null) return []
    const attached = new Set(
      (hardware.snapshot.data()?.hardware ?? [])
        .filter((h) => h.gatewayId === id)
        .map((h) => h.address),
    )
    return scan.results.filter((r) => !attached.has(r.address))
  }, 'hardware.wizard.results')

  const nothingFound = computed(
    () => scanAccepted() && !scanning() && !gatewayOffline() && results().length === 0,
    'hardware.wizard.nothingFound',
  )

  const pinValid = computed(
    () => PairingPinSchema.safeParse(pin()).success,
    'hardware.wizard.pinValid',
  )

  const pinEnabled = computed(() => {
    const current = step()
    if (current.kind !== 'pairing' || current.pairingId === null) return false
    return current.stage === 'pin_required' || current.stage === 'pin_rejected'
  }, 'hardware.wizard.pinEnabled')

  // Decision 7: the hardware showing up on (gateway, address) is "bonded", frame or no frame.
  const bondedHardwareId = computed(() => {
    const current = step()
    const id = gatewayId()
    if (current.kind !== 'pairing' || id === null) return null
    const found = hardware.snapshot
      .data()
      ?.hardware.find((h) => h.gatewayId === id && h.address === current.address)
    return found?.id ?? null
  }, 'hardware.wizard.bondedHardwareId')

  /**
   * Resolves with the first non-null value of `target`, or null once `timeoutMs` passed on the
   * server-aligned clock. Must run inside an action frame (it wraps its own awaits); Task 11 reuses
   * it for the command answer.
   */
  async function waitFor<T>(target: AtomLike<T | null>, timeoutMs: number): Promise<T | null> {
    const deadline = hardware.now() + timeoutMs
    while (true) {
      const value = target()
      if (value !== null) return value
      const remaining = deadline - hardware.now()
      if (remaining <= 0) return null
      await wrap(Promise.race([wrap(take(target)), wrap(sleep(remaining))]))
    }
  }

  /** Re-reads the snapshot and waits for the fresh one; a failed read is logged, not raised. */
  async function rereadSnapshot() {
    hardware.refresh()
    const loaded = await wrap(hardware.snapshot()).then(
      () => null,
      (cause: unknown) => cause,
    )
    if (loaded !== null) console.warn('Hardware wizard snapshot re-read failed:', loaded)
  }

  function profileChoiceFor(hardwareId: string): WizardStep {
    const record = hardware.snapshot.data()?.hardware.find((h) => h.id === hardwareId)
    const slotsFull = (record?.profiles.length ?? 0) >= SCALE_USER_SLOTS
    return { kind: 'profileChoice', hardwareId, slotsFull }
  }

  function currentPairing(pairingId: string): PairingStep | null {
    const current = step()
    return current.kind === 'pairing' && current.pairingId === pairingId ? current : null
  }

  const waitPairing = action(async (pairingId: string) => {
    const current = currentPairing(pairingId)
    if (current === null) return
    const remaining = current.startedAt + PAIRING_TTL_MS - hardware.now()
    const bonded = await waitFor(bondedHardwareId, remaining)
    if (currentPairing(pairingId) === null) return
    if (bonded !== null) {
      step.set(profileChoiceFor(bonded))
      return
    }
    // The pairing's lifetime is over: one last read before calling it failed.
    await rereadSnapshot()
    if (currentPairing(pairingId) === null) return
    const late = bondedHardwareId()
    step.set(late === null ? { kind: 'pairingFailed' } : profileChoiceFor(late))
  }, 'hardware.wizard.waitPairing').extend(withAbort())

  const answerCheck = action(async (pairingId: string) => {
    await wrap(sleep(PAIRING_ANSWER_CHECK_MS))
    if (currentPairing(pairingId) === null || bondedHardwareId() !== null) return
    hardware.refresh()
  }, 'hardware.wizard.answerCheck').extend(withAbort())

  function stopPairingWaits() {
    waitPairing.abort()
    answerCheck.abort()
  }

  function applyPairingFrame(frame: PairingFrame) {
    const current = currentPairing(frame.pairingId)
    if (current === null) return
    if (frame.stage === 'failed') {
      stopPairingWaits()
      step.set({ kind: 'pairingFailed' })
      return
    }
    if (frame.stage === 'bonded') {
      const hardwareId = frame.hardwareId ?? bondedHardwareId()
      // A bonded frame without an id: the snapshot match (waitPairing) finishes the job.
      if (hardwareId === null) return
      stopPairingWaits()
      step.set(profileChoiceFor(hardwareId))
      return
    }
    if (frame.stage === 'pin_rejected') pin.set('')
    step.set({ ...current, stage: frame.stage })
  }

  addCallHook(hardware.received, (event) => {
    if (event.type !== 'pairing' && event.type !== 'command') return
    recentEvents.set((events) => [...events, event].slice(-RECENT_EVENTS_LIMIT))
    if (event.type === 'pairing') applyPairingFrame(event)
  })

  const startScan = action(async () => {
    const id = gatewayId()
    if (id === null) return
    const run = session()
    restartOnOnline.set(false)
    scanAccepted.set(false)
    scanStarting.set(true)
    const result = await wrap(client.scan(id, 'start'))
    if (session() !== run) return
    if (result instanceof Error) {
      scanStarting.set(false)
      if (isHardwareError(result, 'gateway_offline')) {
        // Decision 6: a 409 means the command never reached the gateway; wait for it to return.
        restartOnOnline.set(true)
        hardware.refresh()
        return
      }
      console.warn('Hardware scan start failed:', result.message)
      // Nothing is scanning: show the "nothing found" state so «Искать снова» is offered.
      scanAccepted.set(true)
      return
    }
    scanAccepted.set(true)
    await rereadSnapshot()
    if (session() !== run) return
    scanStarting.set(false)
  }, 'hardware.wizard.startScan')

  // Decision 18 + Review Focus 2: reacts to the gateway's online flag for the whole wizard run.
  const watchGateway = action(async () => {
    while (true) {
      await wrap(take(gatewayOnline))
      const online = gatewayOnline()
      const current = step()
      if (online === false && current.kind === 'pairing') {
        // The gateway lost the pairing: back to the scan, a fresh one once it is back.
        stopPairingWaits()
        pin.set('')
        step.set({ kind: 'scan' })
        restartOnOnline.set(true)
        continue
      }
      if (online === false && current.kind === 'scan' && scanAccepted()) {
        scanAccepted.set(false)
        restartOnOnline.set(true)
        continue
      }
      if (online === true && current.kind === 'scan' && restartOnOnline()) {
        await wrap(startScan())
      }
    }
  }, 'hardware.wizard.watchGateway').extend(withAbort())

  function resetState() {
    stopPairingWaits()
    watchGateway.abort()
    session.set((value) => value + 1)
    step.set({ kind: 'scan' })
    gatewayId.set(null)
    pin.set('')
    scanStarting.set(false)
    scanAccepted.set(false)
    restartOnOnline.set(false)
    recentEvents.set([])
  }

  const openScan = action(async (id: string) => {
    resetState()
    gatewayId.set(id)
    launch(watchGateway(), 'gateway watch')
    await startScan()
  }, 'hardware.wizard.openScan').extend(withAsync())

  const rescan = action(async () => {
    if (step().kind !== 'scan') return
    await startScan()
  }, 'hardware.wizard.rescan').extend(withAsync())

  const choose = action(async (address: BleAddress) => {
    const id = gatewayId()
    if (id === null || step().kind !== 'scan') return
    const run = session()
    pin.set('')
    const started: PairingStep = {
      kind: 'pairing',
      address,
      pairingId: null,
      stage: 'connecting',
      startedAt: hardware.now(),
    }
    step.set(started)
    const result = await wrap(client.pair(id, address))
    if (session() !== run || step() !== started) return
    if (result instanceof Error) {
      if (isHardwareError(result, 'scan_result_unknown')) {
        // The result went stale: back to the list with a fresh scan.
        step.set({ kind: 'scan' })
        await wrap(startScan())
        return
      }
      if (isHardwareError(result, 'gateway_offline')) {
        step.set({ kind: 'scan' })
        scanAccepted.set(false)
        restartOnOnline.set(true)
        hardware.refresh()
        return
      }
      console.warn('Hardware pairing start failed:', result.message)
      step.set({ kind: 'pairingFailed' })
      return
    }
    step.set({ ...started, pairingId: result.pairingId })
    // Frames that beat the HTTP answer, in arrival order.
    for (const event of recentEvents()) {
      if (event.type === 'pairing' && event.pairingId === result.pairingId) applyPairingFrame(event)
    }
    if (currentPairing(result.pairingId) === null) return
    launch(waitPairing(result.pairingId), 'pairing wait')
  }, 'hardware.wizard.choose').extend(withAsync())

  const submitPin = action(async () => {
    const current = step()
    if (current.kind !== 'pairing' || current.pairingId === null) return
    if (!pinEnabled()) return
    const parsed = PairingPinSchema.safeParse(pin())
    if (!parsed.success) return
    const pairingId = current.pairingId
    const run = session()
    const result = await wrap(client.submitPin(pairingId, parsed.data))
    if (session() !== run || currentPairing(pairingId) === null) return
    if (result instanceof Error) {
      if (isHardwareError(result, 'pairing_not_found')) {
        stopPairingWaits()
        step.set({ kind: 'pairingFailed' })
        return
      }
      console.warn('Hardware PIN submit failed:', result.message)
      return
    }
    launch(answerCheck(pairingId), 'pairing answer check')
  }, 'hardware.wizard.submitPin').extend(withAsync())

  const back = action(() => {
    const current = step()
    if (current.kind === 'pairing') {
      stopPairingWaits()
      pin.set('')
      step.set({ kind: 'scan' })
      return
    }
    if (current.kind === 'healthForm' || current.kind === 'attach') {
      step.set(profileChoiceFor(current.hardwareId))
    }
  }, 'hardware.wizard.back')

  const close = action(() => {
    const id = gatewayId()
    if (id !== null && scanning()) {
      // Best effort: the gateway's own scan window ends it anyway.
      void client.scan(id, 'stop').then((result) => {
        if (result instanceof Error) console.warn('Hardware scan stop failed:', result.message)
      })
    }
    resetState()
  }, 'hardware.wizard.close')

  return {
    step,
    gatewayId,
    gatewayOffline,
    scanning,
    results,
    nothingFound,
    pin,
    pinValid,
    pinEnabled,
    openScan,
    rescan,
    choose,
    submitPin,
    back,
    close,
  }
}
