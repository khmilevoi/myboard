import { action, type Action, atom, type Atom, wrap } from '@reatom/core'
import { HttpClient, type HttpLike } from '@shared/http/client'
import type { Navigate } from '@shared/navigation'
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser'
import { startRegistration as browserStartRegistration } from '@simplewebauthn/browser'
import * as errore from 'errore'

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
}

function readTokenFromLocation(): string | null {
  if (typeof location === 'undefined') return null
  return new URLSearchParams(location.search).get('token')
}

function readScanFromLocation(): boolean {
  if (typeof location === 'undefined') return false
  return new URLSearchParams(location.search).get('scan') === '1'
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
  // True from first paint through the end of `init` when the activation link
  // carried a code (`/add-device?token=...`): the code is being server-validated
  // in the background. The UI keeps the "Создать passkey" button in a disabled
  // loading state while this is true, so a click can't race the validation and
  // clobber a later 'waiting' mode. Always false when the URL has no code.
  validating: Atom<boolean>
  extractAddCode: (text: string) => string | null
  submitManual: Action<[string], Promise<void>>
  // Validates a *scanned* code against the server without running the
  // WebAuthn ceremony -- a QR decode is not a user gesture, so
  // `navigator.credentials.create()` must wait for a real click (the
  // "Создать passkey" button, which then calls `startRegistration`).
  // Mirrors `submitManual`'s server-validation step but stops at
  // 'registering' instead of continuing into the ceremony.
  stageScannedCode: Action<[string], Promise<void>>
  startRegistration: Action<[], Promise<void>>
  pollPendingStatus: Action<[], Promise<void>>
  // Called once on mount. When the activation link already carries a code
  // (`/add-device?token=...`), auto-validates it against the server and lands
  // on 'registering' -- the same server-validation-only path as a scanned QR
  // (`stageScannedCode`), stopping at the "Создать passkey" button because
  // `navigator.credentials.create()` still needs a real user gesture. A no-op
  // when the URL has no (valid) code. Idempotent, so React StrictMode's
  // double-invoked mount effect can call it twice safely.
  init: Action<[], Promise<void>>
}

export function makeAddDeviceModel(overrides: Partial<AddDeviceDeps> = {}): AddDeviceModel {
  const deps: AddDeviceDeps = {
    token: overrides.token ?? readTokenFromLocation(),
    scan: overrides.scan ?? readScanFromLocation(),
    currentOrigin: overrides.currentOrigin ?? defaultOrigin(),
    navigate: overrides.navigate ?? ((path) => window.location.assign(path)),
    storage: overrides.storage ?? defaultStorage(),
    http: overrides.http ?? new HttpClient(),
    startRegistrationCeremony: overrides.startRegistrationCeremony ?? browserStartRegistration,
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
  const validating = atom(Boolean(urlCode), 'addDevice.validating')

  let pollIntervalId: ReturnType<typeof window.setInterval> | undefined
  let pollTicks = 0
  // Single-flight guard: with the post-approval ceremony gone, an overlapping
  // duplicate claim is already harmless, but this also stops a second claim from
  // hitting an already-consumed (single-use) ticket.
  let claiming = false

  function stopPolling(): void {
    if (pollIntervalId !== undefined) {
      window.clearInterval(pollIntervalId)
      pollIntervalId = undefined
    }
    pollTicks = 0
  }

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

    stopPolling()

    if (status === 'denied') {
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
      // Retry affordance: resume polling so a later approved tick re-attempts
      // the claim (the single-use ticket is untouched on a failed claim).
      beginPolling()
      return
    }

    if (claim.status === 'denied') {
      mode.set('rejected')
      return
    }

    if (claim.status === 'pending') {
      // Defensive: an `approved` poll should not see the device un-approved on
      // the claim. Resume polling rather than get stuck.
      claiming = false
      beginPolling()
      return
    }

    // claim.status === 'approved'
    deps.storage.set(claim.credentialId)
    mode.set('done')
    deps.navigate('/')
  }, 'addDevice.pollPendingStatus')

  function beginPolling(): void {
    stopPolling()
    pollIntervalId = window.setInterval(
      wrap(() => {
        pollTicks += 1
        if (pollTicks > POLL_MAX_TICKS) {
          stopPolling()
          error.set('Время ожидания подтверждения истекло. Попробуйте снова.')
          return
        }
        void pollPendingStatus()
      }),
      POLL_INTERVAL_MS,
    )
  }

  // Shared by `startRegistration` and `stageScannedCode` -- fetches and
  // validates the registration options for `currentToken` WITHOUT running
  // the WebAuthn ceremony. This is the point where the server actually
  // confirms a code is real (`lookupAddToken`/`checkLive` reject an
  // unknown/expired/exhausted token here with the same generic
  // AddTokenInvalidError either way -- there's no server-side signal to
  // distinguish "invalid" from "expired", so both surface identically).
  async function fetchRegistrationOptions(
    currentToken: string,
  ): Promise<AddDeviceError | PublicKeyCredentialCreationOptionsJSON> {
    const optionsResult = await wrap(
      postJson(deps.http, '/api/auth/devices/register/options', { token: currentToken }),
    )
    if (optionsResult instanceof Error) return optionsResult
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

  // Validates a *scanned* code against the server without running the
  // ceremony -- see the `AddDeviceModel.stageScannedCode` doc comment. Takes
  // the raw decoded QR text (same shared `extractAddCode` as `submitManual`
  // and the manual field's paste handler -- "one implementation, three
  // entry points"). A frame that decodes to something unrelated (any other
  // QR code the camera happens to see) is silently ignored rather than
  // surfaced as an error, matching the scanner's own prior behavior.
  const stageScannedCode = action(async (rawText: string) => {
    const code = extractAddCode(rawText)
    if (!code) return

    error.set(null)
    token.set(code)

    const optionsOrError = await wrap(fetchRegistrationOptions(code))
    if (optionsOrError instanceof Error) {
      error.set(optionsOrError.message)
      // Recoverable: land on the manual-entry screen (design panel 4(c1))
      // rather than stranding the user on 'registering' with no way back.
      mode.set('manual')
      return
    }

    ownerName.set(readOwnerDisplayName(optionsOrError))
    mode.set('registering')
  }, 'addDevice.stageScannedCode')

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
    beginPolling()
  }, 'addDevice.startRegistration')

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

  // Guards against a double run: React StrictMode double-invokes the mount
  // effect in dev, and we must validate the URL code exactly once (a second
  // pass would consume a second register/options round-trip for nothing).
  let initialized = false

  const init = action(async () => {
    if (initialized) return
    initialized = true
    if (!urlCode) return
    // Reuse the QR path verbatim: server-validate the code, then land on
    // 'registering' (initial `mode` already put us there, so a valid code shows
    // no flash) -- or fall back to 'manual' with an error on rejection.
    // `stageScannedCode` never throws (it maps failures to error/mode), so a
    // single unconditional clear afterwards covers both outcomes.
    await wrap(stageScannedCode(urlCode))
    validating.set(false)
  }, 'addDevice.init')

  return {
    token,
    mode,
    error,
    ownerName,
    validating,
    extractAddCode,
    submitManual,
    stageScannedCode,
    startRegistration,
    pollPendingStatus,
    init,
  }
}
