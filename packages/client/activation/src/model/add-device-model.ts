import {
  action,
  type Action,
  atom,
  type Atom,
  computed,
  type Computed,
  withAsync,
  withConnectHook,
  wrap,
} from '@reatom/core'
import { HttpClient, type HttpLike } from '@shared/http/client'
import type { Navigate } from '@shared/navigation'
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser'
import { startRegistration as browserStartRegistration } from '@simplewebauthn/browser'
import * as errore from 'errore'
import { resolveScanConstraints, type ScanMediaDevices } from 'scan-camera'

// Duplicated from packages/client/activation/src/model/activation-model.ts's own
// `CRED_HINT_STORAGE_KEY` (same localStorage key, same non-secret WebAuthn
// credentialId hint) -- this file deliberately doesn't import from
// activation-model.ts (see its own comment on the constant): a tiny shared
// constant is cheaper to duplicate than to couple two otherwise-independent
// model files within this small app.
export const CRED_HINT_STORAGE_KEY = 'mb_cred_hint'

export type AddDeviceMode =
  | 'choose'
  | 'scanning'
  | 'manual'
  | 'registering'
  | 'waiting'
  | 'done'
  | 'rejected'

export class AddDeviceError extends errore.createTaggedError({
  name: 'AddDeviceError',
  message: 'Не удалось добавить устройство: $reason',
}) {}

// The server answered register/options with a 4xx: the code itself is bad
// (unknown, expired, already used or locked -- the server deliberately folds
// all of these into one `add_token_invalid`). Split from `AddDeviceError` so
// the scanner can tell "this code will never work" from "we could not reach
// the server", which only a retry fixes. Same message shape as the generic
// error, so the manual-entry screen's copy is unchanged.
export class AddCodeRejectedError extends errore.createTaggedError({
  name: 'AddCodeRejectedError',
  message:
    'Не удалось добавить устройство: не удалось получить параметры регистрации (код $status)',
}) {}

// What the camera overlay shows on top of the live preview. `idle` and
// `foreign` keep scanning; every other status holds new decodes until the
// user acts (see `stageScannedCode`).
export type ScanStatus =
  | { kind: 'idle' }
  // A myboard code was decoded and is being validated against the server.
  | { kind: 'checking'; code: string }
  // Transient notice: the camera saw a QR code that is not a myboard link.
  | { kind: 'foreign' }
  // A myboard add-device link minted by a different deployment (another
  // stand, or prod vs dev). Hostnames only -- never offered as a link.
  | { kind: 'other-origin'; codeHost: string; currentHost: string }
  // The server refused the code: unknown, expired, used or locked.
  | { kind: 'rejected'; code: string }
  // The server could not be reached or failed; retrying the same code helps.
  | { kind: 'network'; code: string }
  // A same-origin invite link: the frame locks on, then the invite card opens.
  | { kind: 'invite'; token: string }

// Shown on the camera-denied screen (design 4(b2)) when the camera cannot be
// opened: permission denied, no camera, or no mediaDevices at all.
export const CAMERA_DENIED_MESSAGE =
  'Разрешите доступ к камере в настройках браузера или вернитесь назад'

export type ScannerCamera =
  | { kind: 'pending' }
  | { kind: 'ready'; constraints: MediaStreamConstraints }
  | { kind: 'unavailable' }

export type ScannedText =
  | { kind: 'code'; code: string }
  | { kind: 'invite'; token: string }
  | { kind: 'other-origin'; codeHost: string }
  | { kind: 'foreign' }

// How long the "Это не QR-код myboard" notice stays after the last frame that
// decoded to a foreign QR code.
export const FOREIGN_NOTICE_MS = 3_000

// How long the "Приглашение найдено" lock-on plays before the invite card
// replaces the scanner.
export const INVITE_LOCK_MS = 600

export interface AddDeviceStorage {
  get(): string | null
  set(credentialId: string): void
  clear(): void
}

export interface AddDeviceDeps {
  token: string | null
  // True when the activation card routed here via `/add-device?scan=1` to open
  // the camera straight away, skipping the `choose` screen and its redundant
  // second "Сканировать QR-код" tap.
  scan: boolean
  // The origin `extractAddCode` trusts a scanned/pasted `/add-device?token=...`
  // URL to match. Defaults to `location.origin` -- the running app's own
  // origin, which is exactly the host the server embeds in the QR/invite URL
  // (see postAddToken's `PUBLIC_APP_URL()`), regardless of whether the
  // scanning device is physically different hardware. A URL pointing
  // anywhere else (e.g. a phishing link) is rejected outright.
  currentOrigin: string
  navigate: Navigate
  storage: AddDeviceStorage
  http: HttpLike
  // Matches the real @simplewebauthn/browser signature exactly (takes a single
  // `{ optionsJSON }` object), mirroring activation-model.ts's ActivationDeps so
  // a test double stays call-compatible with the real ceremony.
  startRegistrationCeremony: typeof browserStartRegistration
  // Camera access for the scanner; undefined where the browser has none.
  mediaDevices: ScanMediaDevices | undefined
  // `?cam=<index>` debug override: open that camera from the device list.
  cameraIndex: number | null
  // Continues a scanned invite QR on the invite card (the activate route).
  openInvite: (token: string) => void
}

function defaultCameraIndex(): number | null {
  if (typeof location === 'undefined') return null
  const raw = new URLSearchParams(location.search).get('cam')
  if (raw === null || !/^\d+$/.test(raw)) return null
  return Number(raw)
}

function defaultOrigin(): string {
  return typeof location === 'undefined' ? '' : location.origin
}

// Mirrors activation-model.ts's own `defaultStorage` exactly (same key, same
// non-secret-hint rationale) -- duplicated rather than imported, see
// `CRED_HINT_STORAGE_KEY` above.
function defaultStorage(): AddDeviceStorage {
  return {
    get: () =>
      typeof localStorage === 'undefined' ? null : localStorage.getItem(CRED_HINT_STORAGE_KEY),
    set: (credentialId) => {
      if (typeof localStorage !== 'undefined')
        localStorage.setItem(CRED_HINT_STORAGE_KEY, credentialId)
    },
    clear: () => {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(CRED_HINT_STORAGE_KEY)
    },
  }
}

type JsonResult = { status: number; body: Record<string, unknown> }

type ClaimOutcome =
  | { status: 'approved'; credentialId: string }
  | { status: 'pending' }
  | { status: 'denied' }

// Mirrors activation-model.ts's own `postJson` helper, generalized to also
// support the GET used by pending-status polling. Deliberately a plain
// function (not wrapped internally) -- callers inside an action/computed wrap
// the whole call, matching this app's established convention.
async function requestJson(
  http: HttpLike,
  url: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
): Promise<AddDeviceError | JsonResult> {
  const res =
    init.method === 'POST'
      ? await http.post(url, init.body !== undefined ? { json: init.body } : undefined)
      : await http.get(url)
  if (res instanceof Error) {
    return new AddDeviceError({ reason: 'сбой сетевого запроса', cause: res })
  }
  return { status: res.status, body: (res.body ?? {}) as Record<string, unknown> }
}

function postJson(
  http: HttpLike,
  url: string,
  payload: unknown,
): Promise<AddDeviceError | JsonResult> {
  return requestJson(http, url, { method: 'POST', body: payload })
}

function getJson(http: HttpLike, url: string): Promise<AddDeviceError | JsonResult> {
  return requestJson(http, url, { method: 'GET' })
}

// Crockford base32 (no I L O U), 8 characters -- duplicated from
// packages/server/src/auth/add-tokens.ts's `normalizeAddCode`. Browser code
// can't import server internals, so this reimplements the exact same rules
// client-side rather than trusting the server to re-validate a code this UI
// already accepted.
const ADD_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const ADD_CODE_LEN = 8

function normalizeAddCode(input: string): string | null {
  const cleaned = input.toUpperCase().replace(/[^0-9A-Z]/g, '')
  if (cleaned.length !== ADD_CODE_LEN) return null
  for (const ch of cleaned) if (!ADD_CODE_ALPHABET.includes(ch)) return null
  return cleaned
}

const ADD_DEVICE_PATH = '/add-device'
const ACTIVATE_PATH = '/activate'
// Invite tokens are 32 random bytes in base64url (server randomToken()); the
// range leaves room without accepting arbitrary text.
const INVITE_TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/

function inviteTokenOf(url: URL): string | null {
  if (url.pathname !== ACTIVATE_PATH && url.pathname !== `${ACTIVATE_PATH}/`) return null
  const token = url.searchParams.get('token')
  return token && INVITE_TOKEN_RE.test(token) ? token : null
}
const URL_SCHEME_RE = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//

function extractAddCodeFrom(text: string, currentOrigin: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  if (URL_SCHEME_RE.test(trimmed)) {
    let url: URL
    try {
      url = new URL(trimmed)
    } catch {
      return null
    }
    // Same-origin + exact-path check: a scanned/pasted link pointing at a
    // different host or route (e.g. a phishing link) is never trusted,
    // regardless of how well-formed its `token` query param looks.
    if (url.origin !== currentOrigin) return null
    if (url.pathname !== ADD_DEVICE_PATH) return null
    const token = url.searchParams.get('token')
    if (!token) return null
    return normalizeAddCode(token)
  }

  return normalizeAddCode(trimmed)
}

// The scanner's richer reading of the same rules as `extractAddCodeFrom`: on
// top of "usable code or not", it recognizes a well-formed add-device link
// minted on another origin, so the overlay can explain the mismatch instead of
// ignoring the code. Such a link is still never trusted -- only its hostname is
// surfaced, and nothing is fetched or opened from it.
export function classifyScannedText(text: string, currentOrigin: string): ScannedText {
  const code = extractAddCodeFrom(text, currentOrigin)
  if (code) return { kind: 'code', code }

  const trimmed = text.trim()
  if (!URL_SCHEME_RE.test(trimmed)) return { kind: 'foreign' }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return { kind: 'foreign' }
  }
  const inviteToken = inviteTokenOf(url)
  if (url.origin === currentOrigin) {
    return inviteToken ? { kind: 'invite', token: inviteToken } : { kind: 'foreign' }
  }
  if (inviteToken) return { kind: 'other-origin', codeHost: url.host }
  if (url.pathname !== ADD_DEVICE_PATH) return { kind: 'foreign' }
  const token = url.searchParams.get('token')
  if (!token || !normalizeAddCode(token)) return { kind: 'foreign' }
  return { kind: 'other-origin', codeHost: url.host }
}

function hostOf(origin: string): string {
  try {
    return new URL(origin).host
  } catch {
    return origin
  }
}

const POLL_INTERVAL_MS = 2_000
const POLL_TIMEOUT_MS = 10 * 60_000
const POLL_MAX_TICKS = Math.ceil(POLL_TIMEOUT_MS / POLL_INTERVAL_MS)

export interface AddDeviceModel {
  token: Atom<string | null>
  mode: Atom<AddDeviceMode>
  error: Atom<string | null>
  // The account owner's display name, surfaced from register/options'
  // `options.user.displayName` (the server already sets this to
  // `account.name`, see postDeviceRegisterOptions) -- used by the
  // "Добавить устройство в аккаунт «Имя»?" heading once we reach
  // 'registering'. Null before the first successful options fetch.
  ownerName: Atom<string | null>
  // In-flight flag for the "Создать passkey" button (WebAuthn ceremony running),
  // derived from `startRegistration`'s own withAsync status. Exposed as a
  // Computed so the view reads it instead of tracking pending state with React
  // useState (mirrors activation-model.ts's `loading`).
  ceremonyPending: Computed<boolean>
  // Connect this (read it) from the 'waiting' screen to drive pending-status
  // polling. The interval's lifetime is bound to that connection via
  // withConnectHook, so leaving 'waiting'/navigating away stops it automatically.
  poll: Atom<undefined>
  // Named, traceable screen transitions (each clears `error`), owned by the model
  // rather than raw atom.set() calls in the view.
  goToScan: Action<[], void>
  goToManual: Action<[], void>
  goToChoose: Action<[], void>
  extractAddCode: (text: string) => string | null
  submitManual: Action<[string], Promise<void>>
  // Validates a *scanned* code against the server without running the
  // WebAuthn ceremony -- a QR decode is not a user gesture, so
  // `navigator.credentials.create()` must wait for a real click (the
  // "Создать passkey" button, which then calls `startRegistration`).
  // Mirrors `submitManual`'s server-validation step but stops at
  // 'registering' instead of continuing into the ceremony.
  stageScannedCode: Action<[string], Promise<void>>
  // Camera overlay feedback for the scanner path (see `ScanStatus`).
  scanStatus: Atom<ScanStatus>
  // "Сканировать снова": dismiss the overlay's panel and accept decodes again.
  resumeScan: Action<[], void>
  // Which camera the scanner opens (chosen by the scan-camera package). Reading it from
  // the overlay resolves it; it re-resolves each time the overlay mounts.
  camera: Atom<ScannerCamera>
  // The scanner's own getUserMedia failed after the camera was chosen.
  reportCameraError: Action<[], void>
  // "Повторить": re-validate the code that hit a network failure.
  retryScan: Action<[], Promise<void>>
  startRegistration: Action<[], Promise<void>>
  pollPendingStatus: Action<[], Promise<void>>
  // Awaited by the route loader before first render. When the activation link
  // already carries a code (`/add-device?token=...`), auto-validates it against
  // the server and lands on 'registering' -- server validation only, like a
  // scanned QR, stopping at the "Создать passkey" button because
  // `navigator.credentials.create()` still needs a real user gesture. Unlike
  // the scanner, a rejected code falls back to manual entry with the error.
  // A no-op when the URL has no (valid) code. Idempotent as a defensive
  // guard in case the loader ever re-runs for the same model.
  init: Action<[], Promise<void>>
}

export function makeAddDeviceModel(overrides: Partial<AddDeviceDeps> = {}): AddDeviceModel {
  const deps: AddDeviceDeps = {
    token: overrides.token ?? null,
    scan: overrides.scan ?? false,
    currentOrigin: overrides.currentOrigin ?? defaultOrigin(),
    navigate: overrides.navigate ?? ((path) => window.location.assign(path)),
    storage: overrides.storage ?? defaultStorage(),
    http: overrides.http ?? new HttpClient(),
    startRegistrationCeremony: overrides.startRegistrationCeremony ?? browserStartRegistration,
    openInvite:
      overrides.openInvite ??
      ((inviteToken) => window.location.assign(`/activate?token=${inviteToken}`)),
    cameraIndex: overrides.cameraIndex ?? defaultCameraIndex(),
    mediaDevices:
      'mediaDevices' in overrides
        ? overrides.mediaDevices
        : typeof navigator !== 'undefined'
          ? navigator.mediaDevices
          : undefined,
  }

  // A code embedded in the activation link (`/add-device?token=...`). Normalized
  // up front so both the initial `token`/`mode` and the auto-validation in `init`
  // agree on the exact 8-char code. A present code overrides `scan=1`: we open
  // straight into the code-registration path instead of the camera.
  const urlCode = deps.token != null ? normalizeAddCode(deps.token) : null

  const token = atom<string | null>(urlCode ?? deps.token, 'addDevice.token')
  const mode = atom<AddDeviceMode>(
    urlCode ? 'registering' : deps.scan ? 'scanning' : 'choose',
    'addDevice.mode',
  )
  const error = atom<string | null>(null, 'addDevice.error')
  const ownerName = atom<string | null>(null, 'addDevice.ownerName')

  // Elapsed poll ticks, so polling gives up after POLL_TIMEOUT_MS. Reset each
  // time the poller reconnects (see `poll`).
  let pollTicks = 0
  // Single-flight guard: with the post-approval ceremony gone, an overlapping
  // duplicate claim is already harmless, but this also stops a second claim from
  // hitting an already-consumed (single-use) ticket.
  let claiming = false

  function extractAddCode(text: string): string | null {
    return extractAddCodeFrom(text, deps.currentOrigin)
  }

  // Claims the joining device's session once the owner approves it: a single
  // POST authenticated by the pending-ticket cookie. No WebAuthn assertion and
  // no authenticator credential selection — the server already holds everything
  // needed to mint the session (valid pending ticket + device now active). A
  // plain async helper (not a reatom action); its awaited fetch is wrap()ed
  // internally and the caller wrap()s the whole call, matching this file's
  // convention.
  async function claimSession(): Promise<AddDeviceError | ClaimOutcome> {
    const result = await wrap(postJson(deps.http, '/api/auth/devices/claim-session', undefined))
    if (result instanceof Error) return result
    if (result.status !== 200) {
      return new AddDeviceError({ reason: `не удалось получить сессию (код ${result.status})` })
    }

    const body = result.body as {
      status?: 'approved' | 'pending' | 'denied'
      credentialId?: string
    }
    if (body.status === 'approved') {
      if (!body.credentialId) {
        return new AddDeviceError({ reason: 'сервер не вернул идентификатор устройства' })
      }
      return { status: 'approved', credentialId: body.credentialId }
    }
    if (body.status === 'denied') return { status: 'denied' }
    return { status: 'pending' }
  }

  const pollPendingStatus = action(async () => {
    const result = await wrap(getJson(deps.http, '/api/auth/devices/pending-status'))
    if (result instanceof Error) {
      error.set(result.message)
      return
    }
    if (result.status !== 200) {
      error.set(`Не удалось проверить статус (код ${result.status})`)
      return
    }

    // A successful response clears any stale error left behind by an earlier
    // transient failure (mirrors startRegistration/submitManual clearing `error`
    // at entry) -- otherwise a one-off blip's message would linger after
    // polling recovers.
    error.set(null)

    const { status } = result.body as { status: 'approved' | 'pending' | 'denied' }
    if (status === 'pending') return

    if (status === 'denied') {
      // Leaving 'waiting' disconnects the poller (see `poll`) and clears the
      // interval -- no explicit stop needed.
      mode.set('rejected')
      return
    }

    // status === 'approved': mint the session with one server round-trip. The
    // single-flight guard means two overlapping approved polls (a GET slower
    // than the 2s interval) claim at most once.
    if (claiming) return
    claiming = true

    const claim = await wrap(claimSession())
    if (claim instanceof Error) {
      claiming = false
      error.set(claim.message)
      // Stay on 'waiting': the poller is still connected, so a later approved
      // tick re-attempts the claim (the single-use ticket is untouched on a
      // failed claim).
      return
    }

    if (claim.status === 'denied') {
      mode.set('rejected')
      return
    }

    if (claim.status === 'pending') {
      // Defensive: an `approved` poll should not see the device un-approved on
      // the claim. Clear the single-flight guard and let polling continue.
      claiming = false
      return
    }

    // claim.status === 'approved'
    deps.storage.set(claim.credentialId)
    mode.set('done')
    deps.navigate('/')
  }, 'addDevice.pollPendingStatus')

  // Status poller. The 'waiting' screen connects this atom by reading it, so the
  // polling interval's lifetime is bound to that screen staying mounted
  // (withConnectHook): leaving 'waiting' or navigating away from /add-device
  // disconnects it and clears the timer, so polling never outlives the view.
  // Mirrors account-model.ts's `now` clock. The interval callback is wrap()ed so
  // its reatom writes land in a live context, and is created fresh on each
  // (re)connect to avoid a stale wrap() closure aborting after context.reset().
  const poll = atom<undefined>(undefined, 'addDevice.poll').extend(
    withConnectHook(() => {
      pollTicks = 0
      const intervalId = window.setInterval(
        wrap(() => {
          // A terminal mode change (approved -> done, denied -> rejected) is the
          // signal to stop. In production the view also disconnects the poller,
          // but self-clearing here keeps a lingering subscription (e.g. in a
          // unit test) from polling past a terminal state.
          if (mode() !== 'waiting') {
            window.clearInterval(intervalId)
            return
          }
          pollTicks += 1
          if (pollTicks > POLL_MAX_TICKS) {
            window.clearInterval(intervalId)
            error.set('Время ожидания подтверждения истекло. Попробуйте снова.')
            return
          }
          void pollPendingStatus()
        }),
        POLL_INTERVAL_MS,
      )
      return () => window.clearInterval(intervalId)
    }),
  )

  // Shared by `startRegistration` and `stageScannedCode` -- fetches and
  // validates the registration options for `currentToken` WITHOUT running
  // the WebAuthn ceremony. This is the point where the server actually
  // confirms a code is real (`lookupAddToken`/`checkLive` reject an
  // unknown/expired/exhausted token here with the same generic
  // AddTokenInvalidError either way -- there's no server-side signal to
  // distinguish "invalid" from "expired", so both surface identically).
  async function fetchRegistrationOptions(
    currentToken: string,
  ): Promise<AddDeviceError | AddCodeRejectedError | PublicKeyCredentialCreationOptionsJSON> {
    const optionsResult = await wrap(
      postJson(deps.http, '/api/auth/devices/register/options', { token: currentToken }),
    )
    if (optionsResult instanceof Error) return optionsResult
    if (optionsResult.status >= 400 && optionsResult.status < 500) {
      return new AddCodeRejectedError({ status: String(optionsResult.status) })
    }
    if (optionsResult.status !== 200) {
      return new AddDeviceError({
        reason: `не удалось получить параметры регистрации (код ${optionsResult.status})`,
      })
    }

    const { options } = optionsResult.body as {
      options: PublicKeyCredentialCreationOptionsJSON
    }
    return options
  }

  // `options.user` is required by the real `PublicKeyCredentialCreationOptionsJSON`
  // shape (the server always sends it, see postDeviceRegisterOptions), but
  // read defensively via a widened cast rather than assuming it on the
  // exact type -- keeps this tolerant of minimal test fixtures that omit it.
  function readOwnerDisplayName(options: PublicKeyCredentialCreationOptionsJSON): string | null {
    return (options as { user?: { displayName?: string } }).user?.displayName ?? null
  }

  const scanStatus = atom<ScanStatus>({ kind: 'idle' }, 'addDevice.scanStatus')

  // Server-validates `code` for the camera overlay and reports the outcome
  // through `scanStatus`, staying in 'scanning' on failure so the overlay can
  // explain it in place (design 4(b3)-4(b6)). Success lands on 4(d1)'s
  // "Создать passkey" button exactly like the deep-link path.
  async function validateScannedCode(code: string): Promise<void> {
    scanStatus.set({ kind: 'checking', code })
    token.set(code)

    const optionsOrError = await wrap(fetchRegistrationOptions(code))
    // The user closed the scanner or switched to manual entry meanwhile.
    if (mode() !== 'scanning') return
    if (optionsOrError instanceof AddCodeRejectedError) {
      scanStatus.set({ kind: 'rejected', code })
      return
    }
    if (optionsOrError instanceof Error) {
      scanStatus.set({ kind: 'network', code })
      return
    }

    scanStatus.set({ kind: 'idle' })
    ownerName.set(readOwnerDisplayName(optionsOrError))
    mode.set('registering')
  }

  // Lets a foreign-QR notice lapse FOREIGN_NOTICE_MS after the frame that
  // raised it, unless a newer status (another foreign frame included) has
  // replaced it meanwhile -- so the notice stays up while the stray code is
  // still in view and fades once the camera moves off it.
  const expireForeignNotice = action(async (notice: ScanStatus) => {
    await wrap(new Promise((resolve) => setTimeout(resolve, FOREIGN_NOTICE_MS)))
    if (scanStatus() === notice) scanStatus.set({ kind: 'idle' })
  }, 'addDevice.expireForeignNotice')

  // Validates a *scanned* code against the server without running the
  // ceremony -- see the `AddDeviceModel.stageScannedCode` doc comment. Takes
  // the raw decoded QR text. The camera keeps decoding the same code every
  // few hundred milliseconds, so while a check is running or a panel is open
  // further frames are ignored; only `idle` and the transient `foreign`
  // notice accept a new decode.
  const stageScannedCode = action(async (rawText: string) => {
    const current = scanStatus().kind
    if (current !== 'idle' && current !== 'foreign') return

    const scanned = classifyScannedText(rawText, deps.currentOrigin)
    if (scanned.kind === 'foreign') {
      const notice: ScanStatus = { kind: 'foreign' }
      scanStatus.set(notice)
      void expireForeignNotice(notice)
      return
    }
    if (scanned.kind === 'invite') {
      scanStatus.set({ kind: 'invite', token: scanned.token })
      await wrap(new Promise((resolve) => setTimeout(resolve, INVITE_LOCK_MS)))
      // The user closed the scanner during the lock-on.
      if (mode() !== 'scanning') return
      deps.openInvite(scanned.token)
      return
    }
    if (scanned.kind === 'other-origin') {
      scanStatus.set({
        kind: 'other-origin',
        codeHost: scanned.codeHost,
        currentHost: hostOf(deps.currentOrigin),
      })
      return
    }

    error.set(null)
    await wrap(validateScannedCode(scanned.code))
  }, 'addDevice.stageScannedCode')

  const prepareCamera = action(async () => {
    camera.set({ kind: 'pending' })
    const constraints = await wrap(
      resolveScanConstraints(deps.mediaDevices, { cameraIndex: deps.cameraIndex }),
    )
    if (constraints instanceof Error) {
      camera.set({ kind: 'unavailable' })
      error.set(CAMERA_DENIED_MESSAGE)
      return
    }
    camera.set({ kind: 'ready', constraints })
  }, 'addDevice.prepareCamera')

  // Resolved when the scanner overlay connects it (reads it) and again on every
  // reconnect, so reopening the scanner re-checks permission and the camera
  // list; mirrors `poll`'s connection-bound lifetime.
  const camera = atom<ScannerCamera>({ kind: 'pending' }, 'addDevice.camera').extend(
    withConnectHook(() => {
      // Closing the scanner mid-resolve aborts this run with an AbortError;
      // that is the intended cancellation, and every real failure is already
      // returned as a value by resolveScanConstraints.
      prepareCamera().catch(() => undefined)
    }),
  )

  const reportCameraError = action(() => {
    camera.set({ kind: 'unavailable' })
    error.set(CAMERA_DENIED_MESSAGE)
  }, 'addDevice.reportCameraError')

  const resumeScan = action(() => {
    scanStatus.set({ kind: 'idle' })
  }, 'addDevice.resumeScan')

  const retryScan = action(async () => {
    const status = scanStatus()
    if (status.kind !== 'network') return
    await wrap(validateScannedCode(status.code))
  }, 'addDevice.retryScan')

  // The deep-link path (`/add-device?token=...`): there is no camera overlay
  // to explain a failure on, so a rejected code lands on the manual-entry
  // screen (design panel 4(c1)) with the error rather than stranding the user
  // on 'registering' with no way back.
  async function stageLinkCode(code: string): Promise<void> {
    error.set(null)
    token.set(code)

    const optionsOrError = await wrap(fetchRegistrationOptions(code))
    if (optionsOrError instanceof Error) {
      error.set(optionsOrError.message)
      mode.set('manual')
      return
    }

    ownerName.set(readOwnerDisplayName(optionsOrError))
    mode.set('registering')
  }

  const startRegistration = action(async () => {
    error.set(null)
    const currentToken = token()
    if (!currentToken) {
      error.set('Отсутствует код приглашения')
      mode.set('manual')
      return
    }

    const optionsOrError = await wrap(fetchRegistrationOptions(currentToken))
    if (optionsOrError instanceof Error) {
      error.set(optionsOrError.message)
      // Recoverable: the *code itself* was rejected here (never confirmed
      // valid), so land back on the manual-entry screen to let the user
      // edit/resubmit it -- unlike the ceremony/verify failure branches
      // below, which happen only *after* the code was already confirmed
      // valid and so stay on 'registering' for an in-place retry instead.
      mode.set('manual')
      return
    }

    ownerName.set(readOwnerDisplayName(optionsOrError))
    // Only now -- once the server has confirmed the token is real -- do we
    // move to 'registering' (design panel 4(d1)/(d2)). Doing this any
    // earlier (e.g. from `submitManual` before this fetch resolves) is
    // exactly the bug this replaced: a well-formed-but-server-rejected code
    // would otherwise strand the user on 'registering' with no recovery.
    mode.set('registering')

    const attestationResponse = await wrap(
      deps
        .startRegistrationCeremony({ optionsJSON: optionsOrError })
        .catch((cause) => new AddDeviceError({ reason: 'сбой процедуры регистрации', cause })),
    )
    if (attestationResponse instanceof Error) {
      error.set(attestationResponse.message)
      // Deliberately NOT reset to 'manual' -- the code itself was already
      // confirmed valid by the options fetch above. A cancelled/failed
      // WebAuthn prompt (very common -- the user backs out of Face ID/Touch
      // ID) is retried right here via 4(d1)/(d2)'s own in-place error row
      // (AddDeviceScreen.tsx's "Создать passkey" button), not by bouncing
      // to the manual-entry screen and re-validating a code that was never
      // the problem.
      return
    }

    const verifyResult = await wrap(
      postJson(deps.http, '/api/auth/devices/register/verify', {
        token: currentToken,
        attestationResponse,
      }),
    )
    if (verifyResult instanceof Error) {
      error.set(verifyResult.message)
      // Same as the ceremony-failure branch above -- stay on 'registering'.
      return
    }
    if (verifyResult.status !== 200) {
      error.set(`Не удалось подтвердить регистрацию (код ${verifyResult.status})`)
      // Same as the ceremony-failure branch above -- stay on 'registering'.
      return
    }

    mode.set('waiting')
    // Polling starts when the 'waiting' screen connects `poll`; nothing to kick
    // off imperatively here.
  }, 'addDevice.startRegistration').extend(withAsync())

  // In-flight flag for the "Создать passkey" button: true while
  // `startRegistration` (options fetch + WebAuthn ceremony + verify) runs.
  // Sourced from its withAsync status so the view no longer tracks it with React
  // state. Covers the manual/paste path too, since `submitManual` awaits
  // `startRegistration`.
  const ceremonyPending = computed(() => !startRegistration.ready(), 'addDevice.ceremonyPending')

  const goToScan = action(() => {
    error.set(null)
    scanStatus.set({ kind: 'idle' })
    mode.set('scanning')
  }, 'addDevice.goToScan')

  const goToManual = action(() => {
    error.set(null)
    scanStatus.set({ kind: 'idle' })
    mode.set('manual')
  }, 'addDevice.goToManual')

  const goToChoose = action(() => {
    error.set(null)
    scanStatus.set({ kind: 'idle' })
    mode.set('choose')
  }, 'addDevice.goToChoose')

  const submitManual = action(async (input: string) => {
    error.set(null)
    const code = extractAddCode(input)
    if (!code) {
      error.set('Некорректный код. Проверьте и попробуйте снова.')
      return
    }

    token.set(code)
    // `mode` deliberately stays untouched here -- `startRegistration` itself
    // only moves to 'registering' once the server has confirmed the token
    // (see its own comment), and falls back to 'manual' on any failure.
    await wrap(startRegistration())
  }, 'addDevice.submitManual')

  // Guards against a double run: the route loader awaits `init` once, but this
  // keeps a second call (e.g. if the loader ever re-runs for the same model)
  // from consuming a second register/options round-trip for nothing.
  let initialized = false

  const init = action(async () => {
    if (initialized) return
    initialized = true
    if (!urlCode) return
    await wrap(stageLinkCode(urlCode))
  }, 'addDevice.init')

  return {
    token,
    mode,
    error,
    ownerName,
    ceremonyPending,
    poll,
    goToScan,
    goToManual,
    goToChoose,
    extractAddCode,
    submitManual,
    stageScannedCode,
    scanStatus,
    resumeScan,
    camera,
    reportCameraError,
    retryScan,
    startRegistration,
    pollPendingStatus,
    init,
  }
}
