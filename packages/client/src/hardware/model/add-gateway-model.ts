import {
  action,
  type Action,
  atom,
  type Atom,
  type Computed,
  computed,
  sleep,
  withAsync,
  wrap,
} from '@reatom/core'
import type { HardwareBoardClient } from '@shared/hardware/board-client'
import { makeCountdown } from 'widget-sdk/reatom/countdown'

import { describeHardwareError } from './hardware-copy'
import type { HardwareModel } from './hardware-model'

export type AddGatewayPhase = 'minting' | 'waiting' | 'connected' | 'expired' | 'failed'

export type AddGatewayModel = {
  phase: Computed<AddGatewayPhase>
  code: Computed<string | null>
  countdownLabel: Computed<string>
  copied: Atom<boolean>
  error: Atom<string | null>
  /** Mints a code and remembers the gateway ids present at that moment. */
  start: Action<[], Promise<void>>
  /** Writes the code to the clipboard; `copied` stays true for 2 s. */
  copy: Action<[], Promise<void>>
  reset: Action<[], void>
}

export type AddGatewayDeps = {
  hardware: Pick<HardwareModel, 'snapshot' | 'clock'>
  client: HardwareBoardClient
  clipboard?: Pick<Clipboard, 'writeText'>
}

type MintedCode = { code: string; expiresAt: number; knownGatewayIds: string[] }

const COPIED_MS = 2_000

export function makeAddGatewayModel(deps: AddGatewayDeps): AddGatewayModel {
  const { hardware, client } = deps

  const minted = atom<MintedCode | null>(null, 'hardware.addGateway.minted')
  const minting = atom(false, 'hardware.addGateway.minting')
  const error = atom<string | null>(null, 'hardware.addGateway.error')
  const copied = atom(false, 'hardware.addGateway.copied')

  const code = computed(() => minted()?.code ?? null, 'hardware.addGateway.code')
  const countdown = makeCountdown({
    expiresAt: computed(() => minted()?.expiresAt ?? null, 'hardware.addGateway.expiresAt'),
    clock: hardware.clock,
    name: 'hardware.addGateway.countdown',
  })

  const phase = computed((): AddGatewayPhase => {
    if (error() !== null) return 'failed'
    const current = minted()
    if (minting() || current === null) return 'minting'
    // A gateway that was not there when the code was minted and is online now: it used the code.
    const gateways = hardware.snapshot.data()?.gateways ?? []
    const arrived = gateways.some((g) => g.online && !current.knownGatewayIds.includes(g.id))
    if (arrived) return 'connected'
    return countdown.expired() ? 'expired' : 'waiting'
  }, 'hardware.addGateway.phase')

  const start = action(async () => {
    // Reactive inputs are read before the await.
    const knownGatewayIds = (hardware.snapshot.data()?.gateways ?? []).map((g) => g.id)
    error.set(null)
    copied.set(false)
    minted.set(null)
    minting.set(true)
    const result = await wrap(client.mintCode())
    minting.set(false)
    if (result instanceof Error) {
      error.set(describeHardwareError(result))
      return
    }
    minted.set({ code: result.code, expiresAt: result.expiresAt, knownGatewayIds })
  }, 'hardware.addGateway.start').extend(withAsync())

  const copy = action(async () => {
    const text = code()
    if (text === null) return
    const clipboard = deps.clipboard ?? navigator.clipboard
    const written = await wrap(clipboard.writeText(text)).then(
      () => null,
      (cause: unknown) => (cause instanceof Error ? cause : new Error(String(cause))),
    )
    if (written !== null) {
      console.warn('Copying the gateway code failed:', written.message)
      return
    }
    copied.set(true)
    await wrap(sleep(COPIED_MS))
    copied.set(false)
  }, 'hardware.addGateway.copy').extend(withAsync())

  const reset = action(() => {
    minted.set(null)
    minting.set(false)
    error.set(null)
    copied.set(false)
  }, 'hardware.addGateway.reset')

  return { phase, code, countdownLabel: countdown.label, copied, error, start, copy, reset }
}
