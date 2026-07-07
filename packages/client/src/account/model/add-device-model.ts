import {
  action,
  type Action,
  atom,
  type Atom,
  type Computed,
  computed,
  withAsync,
  withConnectHook,
  wrap,
} from '@reatom/core'
import { startAuthentication as browserStartAuthentication } from '@simplewebauthn/browser'
import * as errore from 'errore'

import { createAccountModel } from './account-model'
import { describeDeviceError, fetchAddTokenOptions, mintAddToken } from './devices-http'
import type { DeviceDto } from './devices-http'

export type AddDevicePhase = 'idle' | 'verifying' | 'showing' | 'expired' | 'approving'

export class AddDeviceError extends errore.createTaggedError({
  name: 'AddDeviceError',
  message: 'Не удалось добавить устройство: $reason',
}) {}

// This model only needs the account model's slice that surfaces the pending
// device coming out of this add-token flow and lets it be approved/denied --
// `pending`/`approve`/`deny` are already server-wired on `account-model.ts`
// (Task B2), so `approve()`/`deny()` here are thin delegations rather than a
// second implementation of the same HTTP calls. A plain callable shape (not
// `Pick<AccountModel, ...>`) is intentional: this model only ever *calls*
// `pending()`/`error()`/`approve()`/`deny()`, never touches Reatom-specific
// members (`.subscribe()`, `.extend()`, ...), and a narrower interface keeps
// test doubles trivial while a real `AccountModel` still satisfies it
// structurally (its `Computed`/`Atom`/`Action` members are callable with
// these exact signatures). `error` is required because `account-model.ts`'s
// real `approve`/`deny` never throw -- they catch internally and set their
// OWN `error` atom, then resolve normally -- so this model has to read that
// atom after delegating to surface an approval/denial failure (e.g.
// device-limit-exceeded) into its own `error`.
export type AddDeviceAccountModel = {
  pending: () => DeviceDto[]
  error: () => string | null
  approve: (credentialId: string) => Promise<void>
  deny: (credentialId: string) => Promise<void>
}

export interface AddDeviceDeps {
  fetchImpl: typeof fetch
  accountModel: AddDeviceAccountModel
  // Matches the real @simplewebauthn/browser signature exactly (a single
  // `{ optionsJSON }` object), so a test double stays call-compatible with
  // the real ceremony -- mirrors activation-model.ts's ActivationDeps.
  startAuthenticationCeremony: typeof browserStartAuthentication
}

function formatCountdown(msRemaining: number): string {
  const totalSeconds = Math.max(0, Math.ceil(msRemaining / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export interface AddDeviceModel {
  phase: Computed<AddDevicePhase>
  code: Atom<string | null>
  formatted: Atom<string | null>
  url: Atom<string | null>
  expiresAt: Atom<number | null>
  countdown: Computed<string>
  pendingDevice: Computed<DeviceDto | null>
  error: Atom<string | null>
  start: Action<[], Promise<void>>
  approve: Action<[], Promise<void>>
  deny: Action<[], Promise<void>>
}

export function createAddDeviceModel(overrides: Partial<AddDeviceDeps> = {}): AddDeviceModel {
  const deps: AddDeviceDeps = {
    fetchImpl: overrides.fetchImpl ?? fetch,
    accountModel: overrides.accountModel ?? createAccountModel(),
    startAuthenticationCeremony:
      overrides.startAuthenticationCeremony ?? browserStartAuthentication,
  }

  // Raw state machine driven by `start`/`approve`/`deny`. The publicly exposed
  // `phase` (below) additionally derives 'expired' from the ticking clock, so
  // callers never need to poll for expiry themselves.
  const rawPhase = atom<AddDevicePhase>('idle', 'addDevice.phase.raw')
  const code = atom<string | null>(null, 'addDevice.code')
  const formatted = atom<string | null>(null, 'addDevice.formatted')
  const url = atom<string | null>(null, 'addDevice.url')
  const expiresAt = atom<number | null>(null, 'addDevice.expiresAt')
  const error = atom<string | null>(null, 'addDevice.error')

  // Ticking clock local to this model -- same idiom as
  // packages/widgets/clock/model/clock-model.ts's module-level `clockNow`: a
  // plain atom seeded with a lazy initial-state callback, ticking every
  // second only while something keeps it connected (e.g. a countdown display
  // reading it reactively, or a test that `.subscribe()`s to it/`countdown`).
  const now = atom(() => Date.now(), 'addDevice.now').extend(
    withConnectHook(() => {
      const intervalId = window.setInterval(
        wrap(() => now.set(Date.now())),
        1000,
      )
      return () => window.clearInterval(intervalId)
    }),
  )

  const countdown = computed(() => {
    const expires = expiresAt()
    if (expires == null) return '0:00'
    return formatCountdown(expires - now())
  }, 'addDevice.countdown')

  const phase = computed(() => {
    const raw = rawPhase()
    if (raw !== 'showing') return raw
    const expires = expiresAt()
    if (expires != null && now() >= expires) return 'expired'
    return raw
  }, 'addDevice.phase')

  const pendingDevice = computed(
    () => deps.accountModel.pending().at(-1) ?? null,
    'addDevice.pendingDevice',
  )

  const start = action(async () => {
    error.set(null)
    rawPhase.set('verifying')

    const optionsResult = await wrap(fetchAddTokenOptions(deps.fetchImpl))
    if (optionsResult instanceof Error) {
      error.set(describeDeviceError(optionsResult))
      rawPhase.set('idle')
      return
    }

    // The `.catch()` must chain onto the raw ceremony promise BEFORE it's
    // passed to `wrap(...)`, not onto `wrap(...)`'s result -- chaining after
    // `wrap()` runs the catch continuation (and everything awaited after it)
    // outside the action's own reatom frame. Wrapping the whole
    // promise-plus-catch as one unit keeps the re-entry correct.
    const authenticationResponse = await wrap(
      deps
        .startAuthenticationCeremony({ optionsJSON: optionsResult.options })
        .catch(
          (cause) =>
            new AddDeviceError({ reason: 'сбой процедуры подтверждения устройства', cause }),
        ),
    )
    if (authenticationResponse instanceof Error) {
      error.set(authenticationResponse.message)
      rawPhase.set('idle')
      return
    }

    const mintResult = await wrap(mintAddToken(deps.fetchImpl, authenticationResponse))
    if (mintResult instanceof Error) {
      error.set(describeDeviceError(mintResult))
      rawPhase.set('idle')
      return
    }

    code.set(mintResult.code)
    formatted.set(mintResult.formatted)
    url.set(mintResult.url)
    expiresAt.set(mintResult.expiresAt)
    rawPhase.set('showing')
  }, 'addDevice.start').extend(withAsync())

  // account-model.ts's real `approve`/`deny` never throw -- they catch
  // internally, set their OWN `error` atom, and resolve normally. So after
  // delegating, read that atom back and copy a non-null value into this
  // model's own `error` -- otherwise a delegate failure (e.g.
  // device-limit-exceeded) would silently vanish.
  const approve = action(async () => {
    const device = pendingDevice()
    if (!device) return

    error.set(null)
    rawPhase.set('approving')
    await wrap(deps.accountModel.approve(device.credentialId))
    const delegateError = deps.accountModel.error()
    if (delegateError != null) error.set(delegateError)
    rawPhase.set('idle')
  }, 'addDevice.approve').extend(withAsync())

  const deny = action(async () => {
    const device = pendingDevice()
    if (!device) return

    error.set(null)
    rawPhase.set('approving')
    await wrap(deps.accountModel.deny(device.credentialId))
    const delegateError = deps.accountModel.error()
    if (delegateError != null) error.set(delegateError)
    rawPhase.set('idle')
  }, 'addDevice.deny').extend(withAsync())

  return {
    phase,
    code,
    formatted,
    url,
    expiresAt,
    countdown,
    pendingDevice,
    error,
    start,
    approve,
    deny,
  }
}
