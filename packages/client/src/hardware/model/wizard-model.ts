import {
  action,
  type Action,
  addCallHook,
  type AsyncExt,
  atom,
  type Atom,
  type Computed,
  computed,
  sleep,
  take,
  withAbort,
  withAsync,
  withComputed,
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

import { describeHardwareError } from './hardware-copy'
import type { HardwareModel } from './hardware-model'
import { makeWizardProfileSteps, type WizardProfileSteps } from './wizard-profile'
import { launch, makeWaitFor } from './wizard-waits'

/** After a PIN is submitted with no answer for this long, the wizard re-reads the snapshot (Decision 7). */
export const PAIRING_ANSWER_CHECK_MS = 20_000

/**
 * A scan start refused as `gateway_offline` while the snapshot still says online gets one retry
 * after this long; no online-flag change would ever come to restart it.
 */
export const WIZARD_OFFLINE_RETRY_MS = 5_000

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

/** An async wizard command; `ready()` is false while it runs, so the UI can disable its button. */
export type WizardAsyncAction<Args extends unknown[] = []> = Action<Args, Promise<void>> &
  AsyncExt<Args, void, Error | undefined>

type PairingStep = Extract<WizardStep, { kind: 'pairing' }>
type PairingFrame = Extract<HardwareBoardEvent, { type: 'pairing' }>
type CommandFrame = Extract<HardwareBoardEvent, { type: 'command' }>

export type WizardModel = Omit<WizardProfileSteps, 'loadHealth' | 'reset'> & {
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
  /**
   * The last failed request that has no step of its own (PIN submit, create/attach), as Decision 20
   * copy; cleared by the next attempt and by any step change.
   */
  actionError: Atom<string | null>
  openScan: WizardAsyncAction<[gatewayId: string]>
  /** §2(c) «Подключить профиль»: the wizard opened on an already paired scale's profile choice. */
  openProfile: WizardAsyncAction<[hardwareId: string]>
  rescan: WizardAsyncAction
  choose: WizardAsyncAction<[address: BleAddress]>
  submitPin: WizardAsyncAction
  /** pairing → scan; healthForm/attach/scaleSilent → profileChoice. */
  back: Action<[], void>
  /** Best-effort scan stop, aborts every wait, resets the wizard. */
  close: Action<[], void>
  /** Stops listening to `hardware.received` and resets; the model is unusable afterwards. */
  dispose: () => void
}

export type WizardDeps = {
  hardware: HardwareModel
  client: HardwareBoardClient
  /** The account's health model for the create flow (Decision 10). */
  health: () => Promise<HealthModel | Error>
  /** Whether the board already shows a weight card (Decision 11); read at the done step. */
  hasWeightCard: () => boolean
}

const SCAN_TICK_MS = 1_000
// Recent pairing/command frames kept so a frame that beats its HTTP answer is not lost.
const RECENT_EVENTS_LIMIT = 20

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
  // The one retry for a 409 while the snapshot says online is spent; reset by a 202 or a real drop.
  const offlineRetried = atom(false, 'hardware.wizard.offlineRetried')
  // This run's last start failed with nothing to wait for: no spinner, «Искать снова» offered.
  const scanRefused = atom(false, 'hardware.wizard.scanRefused')
  // §4(c5) learned from a `scale_user_slots_full` answer, which the snapshot may not show yet.
  const slotsFullFor = atom<string | null>(null, 'hardware.wizard.slotsFullFor')

  const recentEvents = atom<Array<PairingFrame | CommandFrame>>([], 'hardware.wizard.recentEvents')
  // An error belongs to the step it was raised on.
  const actionError = atom<string | null>(null, 'hardware.wizard.actionError').extend(
    withComputed(() => {
      step()
      return null
    }),
  )

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
    () =>
      (scanAccepted() || scanRefused()) &&
      !scanning() &&
      !gatewayOffline() &&
      results().length === 0,
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

  const waitFor = makeWaitFor(hardware.now)

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
    const slotsFull =
      (record?.profiles.length ?? 0) >= SCALE_USER_SLOTS || slotsFullFor() === hardwareId
    return { kind: 'profileChoice', hardwareId, slotsFull }
  }

  const profile = makeWizardProfileSteps({
    deps,
    step,
    session,
    recentEvents,
    actionError,
    waitFor,
    rereadSnapshot,
    profileChoiceFor,
    markSlotsFull: (hardwareId) => slotsFullFor.set(hardwareId),
  })

  function currentPairing(pairingId: string): PairingStep | null {
    const current = step()
    return current.kind === 'pairing' && current.pairingId === pairingId ? current : null
  }

  const waitPairing = action(async (pairingId: string) => {
    const current = currentPairing(pairingId)
    if (current === null) return
    const remaining = current.startedAt + PAIRING_TTL_MS - hardware.now()
    const bonded = await wrap(waitFor(bondedHardwareId, remaining))
    if (currentPairing(pairingId) === null) return
    if (bonded !== null) {
      step.set(profileChoiceFor(bonded))
      return
    }
    // The pairing's lifetime is over: one last read before calling it failed.
    await wrap(rereadSnapshot())
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

  // @reatom/core 1001.1.0: addCallHook's unsubscribe does not remove the hook (probed: the callback
  // still fires), so `dispose` also flips this flag, which the hook checks first.
  const disposed = atom(false, 'hardware.wizard.disposed')
  const stopListening = addCallHook(hardware.received, (event) => {
    if (disposed()) return
    if (event.type !== 'pairing' && event.type !== 'command') return
    recentEvents.set((events) => [...events, event].slice(-RECENT_EVENTS_LIMIT))
    if (event.type === 'pairing') applyPairingFrame(event)
  })

  /**
   * Decision 6: a 409 means the command never reached the gateway; wait for it to return. When the
   * fresh snapshot still says online no flag change will come, so retry once, then offer a rescan.
   */
  async function awaitGatewayBack(run: number) {
    restartOnOnline.set(true)
    await wrap(rereadSnapshot())
    if (session() !== run || !restartOnOnline() || gatewayOnline() !== true) return
    if (offlineRetried()) {
      restartOnOnline.set(false)
      scanRefused.set(true)
      return
    }
    offlineRetried.set(true)
    launch(retryScan(), 'offline scan retry')
  }

  const startScan = action(async () => {
    const id = gatewayId()
    if (id === null) return
    const run = session()
    restartOnOnline.set(false)
    scanAccepted.set(false)
    scanRefused.set(false)
    scanStarting.set(true)
    const result = await wrap(client.scan(id, 'start'))
    if (session() !== run) return
    if (result instanceof Error) {
      scanStarting.set(false)
      if (isHardwareError(result, 'gateway_offline')) {
        await wrap(awaitGatewayBack(run))
        return
      }
      console.warn('Hardware scan start failed:', result.message)
      // Nothing is scanning, and a record this run did not start never spins (Review Focus 2).
      scanRefused.set(true)
      return
    }
    offlineRetried.set(false)
    scanAccepted.set(true)
    await wrap(rereadSnapshot())
    if (session() !== run) return
    scanStarting.set(false)
  }, 'hardware.wizard.startScan')

  const retryScan = action(async () => {
    await wrap(sleep(WIZARD_OFFLINE_RETRY_MS))
    if (step().kind !== 'scan' || !restartOnOnline() || gatewayOnline() !== true) return
    await wrap(startScan())
  }, 'hardware.wizard.retryScan').extend(withAbort())

  // Decision 18 + Review Focus 2: reacts to the gateway's online flag for the whole wizard run.
  const watchGateway = action(async () => {
    while (true) {
      await wrap(take(gatewayOnline))
      const online = gatewayOnline()
      const current = step()
      // A real drop: the next 409-while-online episode gets its own retry.
      if (online === false) offlineRetried.set(false)
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
    retryScan.abort()
    profile.reset()
    session.set((value) => value + 1)
    step.set({ kind: 'scan' })
    gatewayId.set(null)
    pin.set('')
    scanStarting.set(false)
    scanAccepted.set(false)
    restartOnOnline.set(false)
    offlineRetried.set(false)
    scanRefused.set(false)
    slotsFullFor.set(null)
    recentEvents.set([])
  }

  const openScan = action(async (id: string) => {
    resetState()
    gatewayId.set(id)
    launch(watchGateway(), 'gateway watch')
    launch(profile.loadHealth(), 'health model load')
    await wrap(startScan())
  }, 'hardware.wizard.openScan').extend(withAsync())

  const openProfile = action(async (hardwareId: string) => {
    resetState()
    const run = session()
    if (hardware.snapshot.data() === null) await wrap(rereadSnapshot())
    if (session() !== run) return
    const record = hardware.snapshot.data()?.hardware.find((h) => h.id === hardwareId)
    gatewayId.set(record?.gatewayId ?? null)
    step.set(profileChoiceFor(hardwareId))
    await wrap(profile.loadHealth())
  }, 'hardware.wizard.openProfile').extend(withAsync())

  const rescan = action(async () => {
    if (step().kind !== 'scan') return
    await wrap(startScan())
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
        await wrap(awaitGatewayBack(run))
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
    actionError.set(null)
    const result = await wrap(client.submitPin(pairingId, parsed.data))
    if (session() !== run || currentPairing(pairingId) === null) return
    if (result instanceof Error) {
      if (isHardwareError(result, 'pairing_not_found')) {
        stopPairingWaits()
        step.set({ kind: 'pairingFailed' })
        return
      }
      // e.g. 409 pairing_not_waiting_pin or a network failure: the step stays, the UI shows why.
      console.warn('Hardware PIN submit failed:', result.message)
      actionError.set(describeHardwareError(result))
      return
    }
    launch(answerCheck(pairingId), 'pairing answer check')
  }, 'hardware.wizard.submitPin').extend(withAsync())

  const back = action(() => {
    const current = step()
    if (current.kind === 'pairing') {
      stopPairingWaits()
      pin.set('')
      // Frames of the abandoned pairing must not replay into the next one.
      recentEvents.set([])
      step.set({ kind: 'scan' })
      return
    }
    if (
      current.kind === 'healthForm' ||
      current.kind === 'attach' ||
      current.kind === 'scaleSilent'
    ) {
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

  function dispose() {
    disposed.set(true)
    stopListening()
    resetState()
  }

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
    actionError,
    healthProfile: profile.healthProfile,
    profileForm: profile.profileForm,
    formError: profile.formError,
    consent: profile.consent,
    consentValid: profile.consentValid,
    attachIndexes: profile.attachIndexes,
    boardNeedsWeightCard: profile.boardNeedsWeightCard,
    create: profile.create,
    saveHealthAndCreate: profile.saveHealthAndCreate,
    openAttach: profile.openAttach,
    selectIndex: profile.selectIndex,
    attach: profile.attach,
    retry: profile.retry,
    openScan,
    openProfile,
    rescan,
    choose,
    submitPin,
    back,
    close,
    dispose,
  }
}
