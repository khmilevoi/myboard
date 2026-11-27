import {
  action,
  type Action,
  type AsyncDataExt,
  atom,
  type Atom,
  type Computed,
  computed,
  withAsync,
  withAsyncData,
  withComputed,
  withConnectHook,
  wrap,
} from '@reatom/core'
import type { HardwareBoardEvent, HardwareSnapshot } from '@shared/hardware/board-api'
import type { HardwareBoardClient, HardwareClientError } from '@shared/hardware/board-client'
import { HARDWARE_EVENTS_URL, parseHardwareFrame } from '@shared/hardware/board-events'
import type { BleAddress } from '@shared/hardware/models'
import type { ScaleUserIndex } from '@shared/hardware/spike-assumptions'
import type { EventStreamMessage, OpenEventStream } from '@shared/http/event-stream'
import { getServerTime } from 'widget-runtime'
import { makeTickingNow } from 'widget-sdk/reatom/countdown'

import { describeHardwareError } from './hardware-copy'
import { deriveHardwareWindow, type HardwareWindow } from './hardware-view'

export type HardwareView = 'list' | 'addGateway' | 'wizard'

export type ConfirmTarget =
  | { kind: 'revokeGateway'; gatewayId: string }
  | { kind: 'unpair'; hardwareId: string }
  | { kind: 'removeDetached'; hardwareId: string }
  | { kind: 'unbind'; hardwareId: string; index: ScaleUserIndex }

export type RevealedCode = { hardwareId: string; index: ScaleUserIndex; consentCode: string }

export type HardwareDeps = {
  client: HardwareBoardClient
  openEventStream: OpenEventStream
  /** Server-aligned clock; defaults to `getServerTime().nowMs() ?? Date.now()`. */
  now?: () => number
}

export type HardwareSnapshotQuery = Computed<Promise<HardwareSnapshot>> &
  AsyncDataExt<[], HardwareSnapshot, HardwareSnapshot | null, HardwareSnapshot | null>

export type HardwareModel = {
  /** The board's hardware registry; connecting it opens the live board-event stream. */
  snapshot: HardwareSnapshotQuery
  clock: Atom<number>
  window: Computed<HardwareWindow | null>
  /** Refetches the snapshot (bumps the version the query reads). */
  refresh: Action<[], void>
  /** Every parsed board event; the wizard listens with `take()`. */
  received: Action<[HardwareBoardEvent], HardwareBoardEvent>
  view: Atom<HardwareView>
  confirm: Atom<ConfirmTarget | null>
  revealed: Atom<RevealedCode | null>
  actionError: Atom<string | null>
  /** Runs the open confirm's request; closes it on success, keeps it open with `actionError` on failure. */
  confirmAction: Action<[], Promise<void>>
  revealCode: Action<[hardwareId: string, index: ScaleUserIndex], Promise<void>>
  hideCode: Action<[], void>
  adopt: Action<[gatewayId: string, address: BleAddress], Promise<void>>
  /** The dialog closed: back to the list with nothing open. */
  reset: Action<[], void>
}

const CLOCK_INTERVAL_MS = 30_000

// Snapshot-changing board events (Decision 5); `pairing` and `command` only go to `received`.
const REFRESHING_EVENTS = new Set<HardwareBoardEvent['type']>([
  'changed',
  'scan.result',
  'scan.finished',
])

function defaultNow(): number {
  return getServerTime().nowMs() ?? Date.now()
}

function runConfirm(
  client: HardwareBoardClient,
  target: ConfirmTarget,
): Promise<HardwareClientError | void> {
  if (target.kind === 'revokeGateway') return client.revokeGateway(target.gatewayId)
  if (target.kind === 'unbind') return client.unbind(target.hardwareId, target.index)
  return client.unpair(target.hardwareId)
}

export function makeHardwareModel(deps: HardwareDeps): HardwareModel {
  const { client, openEventStream } = deps
  const now = deps.now ?? defaultNow

  const version = atom(0, 'hardware.version')
  const refresh = action(() => {
    version.set((value) => value + 1)
  }, 'hardware.refresh')

  const received = action((event: HardwareBoardEvent) => event, 'hardware.received')

  function onMessage(message: EventStreamMessage) {
    if (message.event === 'ready') {
      refresh()
      return
    }
    const event = parseHardwareFrame(message.data)
    if (event === null) return
    received(event)
    if (REFRESHING_EVENTS.has(event.type)) refresh()
  }

  const snapshot = computed(async () => {
    version()
    const result = await wrap(client.snapshot())
    // The async-data boundary: a thrown client error is what `withAsyncData` records in `.error()`.
    if (result instanceof Error) throw result
    return result
  }, 'hardware.snapshot').extend(
    withAsyncData({ initState: null }),
    withConnectHook(() => {
      const stream = openEventStream(HARDWARE_EVENTS_URL, {
        events: ['ready'],
        onMessage: wrap(onMessage),
      })
      return () => stream.close()
    }),
  )

  const clock = makeTickingNow({ now, intervalMs: CLOCK_INTERVAL_MS, name: 'hardware.clock' })

  const window = computed(() => {
    const data = snapshot.data()
    return data === null ? null : deriveHardwareWindow(data, clock())
  }, 'hardware.window')

  const view = atom<HardwareView>('list', 'hardware.view')
  const confirm = atom<ConfirmTarget | null>(null, 'hardware.confirm')
  // One inline row at a time: opening a confirm closes the revealed code.
  const revealed = atom<RevealedCode | null>(null, 'hardware.revealed').extend(
    withComputed((state) => (confirm() === null ? state : null)),
  )
  // An error belongs to the confirm it was raised under; switching the confirm drops it.
  const actionError = atom<string | null>(null, 'hardware.actionError').extend(
    withComputed(() => {
      confirm()
      return null
    }),
  )

  const confirmAction = action(async () => {
    const target = confirm()
    if (target === null) return
    actionError.set(null)
    const result = await wrap(runConfirm(client, target))
    if (result instanceof Error) {
      actionError.set(describeHardwareError(result))
      return
    }
    confirm.set(null)
    refresh()
  }, 'hardware.confirmAction').extend(withAsync())

  const revealCode = action(async (hardwareId: string, index: ScaleUserIndex) => {
    actionError.set(null)
    const result = await wrap(client.revealConsentCode(hardwareId, index))
    if (result instanceof Error) {
      actionError.set(describeHardwareError(result))
      return
    }
    confirm.set(null)
    revealed.set({ hardwareId, index, consentCode: result.consentCode })
  }, 'hardware.revealCode').extend(withAsync())

  const hideCode = action(() => {
    revealed.set(null)
  }, 'hardware.hideCode')

  const adopt = action(async (gatewayId: string, address: BleAddress) => {
    actionError.set(null)
    const result = await wrap(client.adopt(gatewayId, address))
    if (result instanceof Error) {
      actionError.set(describeHardwareError(result))
      return
    }
    refresh()
  }, 'hardware.adopt').extend(withAsync())

  const reset = action(() => {
    view.set('list')
    confirm.set(null)
    revealed.set(null)
    actionError.set(null)
  }, 'hardware.reset')

  return {
    snapshot,
    clock,
    window,
    refresh,
    received,
    view,
    confirm,
    revealed,
    actionError,
    confirmAction,
    revealCode,
    hideCode,
    adopt,
    reset,
  }
}
