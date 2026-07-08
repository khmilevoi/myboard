import {
  action,
  type Action,
  atom,
  type Atom,
  type Computed,
  computed,
  effect,
  withAsync,
  withConnectHook,
  wrap,
} from '@reatom/core'
import type { HttpLike } from '@shared/http/client'
import { startAuthentication as browserStartAuthentication } from '@simplewebauthn/browser'
import * as errore from 'errore'
import QRCodeStyling, { type Options as QrOptions } from 'qr-code-styling'

import type { ResolvedTheme } from '@/shared/theme/types'
import { resolvedTheme as globalResolvedTheme } from '@/theme/model/theme-model'

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
  http: HttpLike
  accountModel: AddDeviceAccountModel
  // Matches the real @simplewebauthn/browser signature exactly (a single
  // `{ optionsJSON }` object), so a test double stays call-compatible with
  // the real ceremony -- mirrors activation-model.ts's ActivationDeps.
  startAuthenticationCeremony: typeof browserStartAuthentication
  // A callable reader, not just a plain value -- defaults to the app-wide
  // `resolvedTheme` computed (@/theme/model/theme-model.ts) so `qrOptions`
  // (below) reactively re-derives the QR's dot color whenever the theme
  // flips, matching every other DI'd dependency's "callable, overridable"
  // shape in this file. Tests inject a plain `atom<ResolvedTheme>(...)`
  // instead of mutating the real global theme atoms.
  resolvedTheme: () => ResolvedTheme
}

function formatCountdown(msRemaining: number): string {
  const totalSeconds = Math.max(0, Math.ceil(msRemaining / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

// Duplicated from packages/client/src/shared/theme/tokens.css's `--primary`
// (light/dark) literal values, not read via `getComputedStyle` -- QR dots
// need a real, parseable color string at construction/update time, and
// `getComputedStyle` would return an empty string in a unit-test jsdom
// environment that never loaded tokens.css as a real stylesheet. Mirrors the
// same "derive a literal, don't read the DOM" choice `theme-model.ts`'s own
// `applyTheme` makes for the *browser* runtime (where it reads the DOM
// because a real stylesheet IS loaded there) -- here we go the other way
// since this value must also be constructible in tests.
const QR_PRIMARY_BY_THEME: Record<ResolvedTheme, string> = {
  light: 'oklch(0.55 0.17 281)',
  dark: 'oklch(0.68 0.15 285)',
}

// The QR's own background chip stays a literal white regardless of theme
// (`Мультиустройства.dc.html` panel "3" state (b): `background:#ffffff`) --
// a deliberately "light" surface so the code stays reliably scannable
// against dark-mode dots, not themed like the rest of the modal.
const QR_BACKGROUND_COLOR = '#ffffff'
const QR_SIZE_PX = 167

export interface AddDeviceModel {
  phase: Computed<AddDevicePhase>
  code: Atom<string | null>
  formatted: Atom<string | null>
  url: Atom<string | null>
  expiresAt: Atom<number | null>
  countdown: Computed<string>
  pendingDevice: Computed<DeviceDto | null>
  justApproved: Atom<DeviceDto | null>
  error: Atom<string | null>
  // The real, stable `qr-code-styling` instance -- constructed once here so
  // this model owns "building the QR-code instance" per the brief. Its own
  // `.append(container)`/`.update(options)` methods are DOM-touching calls
  // that belong to the *view* (the only two things it's allowed to call on
  // this object); the model's job stops at constructing it and deriving
  // `qrOptions` below for the view to pass into `.update(...)`.
  qrCode: QRCodeStyling
  // `null` until a code/url has been minted; re-derives `dotsOptions.color`
  // whenever `resolvedTheme()` changes so the view can `.update()` the QR in
  // place ("regenerating on theme change").
  qrOptions: Computed<Partial<QrOptions> | null>
  // `true` while either `approve()` or `deny()` is in flight. Exposed as its
  // own `Computed` (mirrors account-model.ts's own `loading`) rather than
  // requiring callers to read `approve.ready()`/`deny.ready()` directly --
  // those are only visible on this factory's own locally-inferred variable
  // types, not on the narrower `Action<[], Promise<void>>` this interface
  // declares, so an external caller (e.g. AddDeviceModal.tsx) can't call
  // `.ready()` through `AddDeviceModel` itself.
  busy: Computed<boolean>
  start: Action<[], Promise<void>>
  approve: Action<[], Promise<void>>
  deny: Action<[], Promise<void>>
  // Clears the whole flow back to its initial idle values (rawPhase, minted
  // code/formatted/url/expiresAt, error, justApproved). The view calls this
  // when its dialog *closes*, not when it opens -- since this model instance
  // is created once and persists for as long as the owning dialog is
  // mounted (which itself never remounts between opens), without this a
  // successful approval's `justApproved` (design state (e), which has no
  // buttons at all) would dead-end every future reopen of the same modal.
  reset: Action<[], void>
}

export function createAddDeviceModel(
  overrides: Partial<AddDeviceDeps> & { http: HttpLike; accountModel: AddDeviceAccountModel },
): AddDeviceModel {
  const deps: AddDeviceDeps = {
    http: overrides.http,
    accountModel: overrides.accountModel,
    startAuthenticationCeremony:
      overrides.startAuthenticationCeremony ?? browserStartAuthentication,
    resolvedTheme: overrides.resolvedTheme ?? (() => globalResolvedTheme()),
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
  // Set only on a *successful* approve() (never on deny()), read by the view
  // to flip to the "device added" success card (design state (e)) instead of
  // falling back to the idle "confirm identity" screen once the approval
  // card (driven by `pendingDevice`) closes. Cleared at the start of a fresh
  // `start()`/`approve()`/`deny()` cycle so a stale success card can't
  // resurface after a later action.
  const justApproved = atom<DeviceDto | null>(null, 'addDevice.justApproved')

  // Bumped by `reset()`. Each async action captures the current value at its
  // start and re-checks it after every `await` before writing any result --
  // if `reset()` ran while the action was in flight (e.g. the user closed
  // the dialog mid-ceremony/mid-approval), the captured value no longer
  // matches and the stale continuation's writes become a no-op instead of
  // resurrecting `phase`/`code`/`justApproved`/`error` after `reset()`
  // already cleared them.
  let generation = 0

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

  // Clears a stale `error` (a ceremony failure showing on the idle/showing
  // screen, or a stale delegate failure from a *previous* device) whenever
  // `pendingDevice` transitions to a *different*, non-null device -- e.g. an
  // unrelated `device-pending` SSE event elsewhere refreshing the shared
  // account model while this model's own error is still on screen. Tracks
  // the previously-seen credentialId (not just "is it non-null") so this
  // does NOT clear an error that `approve()`/`deny()` just set for the SAME
  // still-pending device (a failed approve/deny never changes `pending`,
  // per account-model.ts's real contract of only calling refresh() on
  // success) -- only a genuine change in *which* device is pending counts.
  let lastPendingCredentialId: string | null = null
  effect(() => {
    const device = pendingDevice()
    const currentCredentialId = device?.credentialId ?? null
    if (currentCredentialId != null && currentCredentialId !== lastPendingCredentialId) {
      error.set(null)
    }
    lastPendingCredentialId = currentCredentialId
  }, 'addDevice.clearErrorOnNewPendingDevice')

  // Constructed once, with a non-empty placeholder `data` (qr-code-styling's
  // internal QR generator throws on empty string data) so `.append()` never
  // fails even before a real url has been minted. `type: 'svg'` avoids
  // needing a canvas 2D context (unavailable in jsdom without the optional
  // `canvas` package) -- svg element creation works in any DOM, real browser
  // or jsdom alike.
  const qrCode = new QRCodeStyling({
    width: QR_SIZE_PX,
    height: QR_SIZE_PX,
    type: 'svg',
    margin: 0,
    data: 'myboard',
    qrOptions: { errorCorrectionLevel: 'Q' },
    dotsOptions: { type: 'square', color: QR_PRIMARY_BY_THEME[deps.resolvedTheme()] },
    backgroundOptions: { color: QR_BACKGROUND_COLOR },
  })

  const qrOptions = computed<Partial<QrOptions> | null>(() => {
    const currentUrl = url()
    if (currentUrl == null) return null
    return {
      data: currentUrl,
      width: QR_SIZE_PX,
      height: QR_SIZE_PX,
      type: 'svg',
      margin: 0,
      qrOptions: { errorCorrectionLevel: 'Q' },
      dotsOptions: { type: 'square', color: QR_PRIMARY_BY_THEME[deps.resolvedTheme()] },
      backgroundOptions: { color: QR_BACKGROUND_COLOR },
    } as const
  }, 'addDevice.qrOptions')

  const start = action(async () => {
    const myGeneration = generation
    error.set(null)
    justApproved.set(null)
    rawPhase.set('verifying')

    const optionsResult = await wrap(fetchAddTokenOptions(deps.http))
    if (myGeneration !== generation) return
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
    if (myGeneration !== generation) return
    if (authenticationResponse instanceof Error) {
      error.set(authenticationResponse.message)
      rawPhase.set('idle')
      return
    }

    const mintResult = await wrap(mintAddToken(deps.http, authenticationResponse))
    if (myGeneration !== generation) return
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
    const myGeneration = generation
    justApproved.set(null)
    const device = pendingDevice()
    if (!device) return

    error.set(null)
    rawPhase.set('approving')
    await wrap(deps.accountModel.approve(device.credentialId))
    if (myGeneration !== generation) return
    const delegateError = deps.accountModel.error()
    if (delegateError != null) {
      error.set(delegateError)
    } else {
      justApproved.set(device)
    }
    rawPhase.set('idle')
  }, 'addDevice.approve').extend(withAsync())

  const deny = action(async () => {
    const myGeneration = generation
    justApproved.set(null)
    const device = pendingDevice()
    if (!device) return

    error.set(null)
    rawPhase.set('approving')
    await wrap(deps.accountModel.deny(device.credentialId))
    if (myGeneration !== generation) return
    const delegateError = deps.accountModel.error()
    if (delegateError != null) error.set(delegateError)
    rawPhase.set('idle')
  }, 'addDevice.deny').extend(withAsync())

  const busy = computed(() => !approve.ready() || !deny.ready(), 'addDevice.busy')

  const reset = action(() => {
    generation += 1
    rawPhase.set('idle')
    code.set(null)
    formatted.set(null)
    url.set(null)
    expiresAt.set(null)
    error.set(null)
    justApproved.set(null)
  }, 'addDevice.reset')

  return {
    phase,
    code,
    formatted,
    url,
    expiresAt,
    countdown,
    pendingDevice,
    justApproved,
    error,
    qrCode,
    qrOptions,
    busy,
    start,
    approve,
    deny,
    reset,
  }
}
