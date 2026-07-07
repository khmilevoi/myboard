import { action, type Action, atom, type Atom, wrap } from '@reatom/core'
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'
import {
  startAuthentication as browserStartAuthentication,
  startRegistration as browserStartRegistration,
} from '@simplewebauthn/browser'
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
  // The origin `extractAddCode` trusts a scanned/pasted `/add-device?token=...`
  // URL to match. Defaults to `location.origin` -- the running app's own
  // origin, which is exactly the host the server embeds in the QR/invite URL
  // (see postAddToken's `PUBLIC_APP_URL()`), regardless of whether the
  // scanning device is physically different hardware. A URL pointing
  // anywhere else (e.g. a phishing link) is rejected outright.
  currentOrigin: string
  navigate: (path: string) => void
  storage: AddDeviceStorage
  fetchImpl: typeof fetch
  // Matches the real @simplewebauthn/browser signatures exactly (both take a
  // single `{ optionsJSON }` object), mirroring activation-model.ts's
  // ActivationDeps so a test double stays call-compatible with the real
  // ceremony.
  startRegistrationCeremony: typeof browserStartRegistration
  startAuthenticationCeremony: typeof browserStartAuthentication
}

function readTokenFromLocation(): string | null {
  if (typeof location === 'undefined') return null
  return new URLSearchParams(location.search).get('token')
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

// Mirrors activation-model.ts's own `postJson` helper, generalized to also
// support the GET used by pending-status polling. Deliberately a plain
// function (not wrapped internally) -- callers inside an action/computed wrap
// the whole call, matching this app's established convention.
async function requestJson(
  fetchImpl: typeof fetch,
  url: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
): Promise<AddDeviceError | JsonResult> {
  const res = await fetchImpl(url, {
    method: init.method,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'MyBoard',
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  }).catch((cause) => new AddDeviceError({ reason: 'сбой сетевого запроса', cause }))
  if (res instanceof Error) return res

  const body = await res
    .json()
    .catch((cause) => new AddDeviceError({ reason: 'некорректный ответ сервера', cause }))
  if (body instanceof Error) return body as AddDeviceError

  return { status: res.status, body: body as Record<string, unknown> }
}

function postJson(
  fetchImpl: typeof fetch,
  url: string,
  payload: unknown,
): Promise<AddDeviceError | JsonResult> {
  return requestJson(fetchImpl, url, { method: 'POST', body: payload })
}

function getJson(fetchImpl: typeof fetch, url: string): Promise<AddDeviceError | JsonResult> {
  return requestJson(fetchImpl, url, { method: 'GET' })
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
  extractAddCode: (text: string) => string | null
  submitManual: Action<[string], Promise<void>>
  startRegistration: Action<[], Promise<void>>
  pollPendingStatus: Action<[], Promise<void>>
}

export function createAddDeviceModel(overrides: Partial<AddDeviceDeps> = {}): AddDeviceModel {
  const deps: AddDeviceDeps = {
    token: overrides.token ?? readTokenFromLocation(),
    currentOrigin: overrides.currentOrigin ?? defaultOrigin(),
    navigate: overrides.navigate ?? ((path) => window.location.assign(path)),
    storage: overrides.storage ?? defaultStorage(),
    fetchImpl: overrides.fetchImpl ?? fetch,
    startRegistrationCeremony: overrides.startRegistrationCeremony ?? browserStartRegistration,
    startAuthenticationCeremony:
      overrides.startAuthenticationCeremony ?? browserStartAuthentication,
  }

  const token = atom<string | null>(deps.token, 'addDevice.token')
  const mode = atom<AddDeviceMode>('choose', 'addDevice.mode')
  const error = atom<string | null>(null, 'addDevice.error')

  // The just-registered device's own credentialId, captured after a
  // successful register/verify -- used as the login hint once the owner
  // approves it. Plain closure state (not exposed/reactive), same idiom as
  // account/model/add-device-model.ts's `generation`/`lastPendingCredentialId`.
  let registeredCredentialId: string | null = null
  let pollIntervalId: ReturnType<typeof window.setInterval> | undefined
  let pollTicks = 0

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

  // A single normal login attempt (options -> ceremony -> verify), run once
  // the owner approves this device -- the pending ticket issued at
  // register/verify only proves *this* device was allowed to keep polling,
  // it is not itself a session cookie. Mirrors activation-model.ts's own
  // `attemptLogin` shape (a plain async helper, not a reatom action itself;
  // each of its own awaited external promises is still individually
  // `wrap()`ed, matching that file's convention).
  async function completeLoginAfterApproval(
    hint: string | null,
  ): Promise<AddDeviceError | { credentialId: string }> {
    const optionsResult = await wrap(
      postJson(deps.fetchImpl, '/api/auth/login/options', hint ? { credentialIdHint: hint } : {}),
    )
    if (optionsResult instanceof Error) return optionsResult
    if (optionsResult.status !== 200) {
      return new AddDeviceError({
        reason: `не удалось получить параметры входа (код ${optionsResult.status})`,
      })
    }

    const { options } = optionsResult.body as { options: PublicKeyCredentialRequestOptionsJSON }

    // `.catch()` chains onto the raw ceremony promise BEFORE it's passed to
    // `wrap(...)`, not onto `wrap(...)`'s result -- chaining after `wrap()`
    // would run the catch continuation (and everything awaited after it)
    // outside the action's own reatom frame.
    const authenticationResponse = await wrap(
      deps
        .startAuthenticationCeremony({ optionsJSON: options })
        .catch((cause) => new AddDeviceError({ reason: 'сбой процедуры входа', cause })),
    )
    if (authenticationResponse instanceof Error) return authenticationResponse

    const verifyResult = await wrap(
      postJson(deps.fetchImpl, '/api/auth/login/verify', { authenticationResponse }),
    )
    if (verifyResult instanceof Error) return verifyResult
    if (verifyResult.status !== 200) {
      return new AddDeviceError({
        reason: `не удалось подтвердить вход (код ${verifyResult.status})`,
      })
    }

    const { credentialId } = verifyResult.body as { credentialId: string }
    return { credentialId }
  }

  const pollPendingStatus = action(async () => {
    const result = await wrap(getJson(deps.fetchImpl, '/api/auth/devices/pending-status'))
    if (result instanceof Error) {
      error.set(result.message)
      return
    }
    if (result.status !== 200) {
      error.set(`Не удалось проверить статус (код ${result.status})`)
      return
    }

    // A successful response clears any stale error left behind by an
    // earlier transient failure (mirrors `startRegistration`/`submitManual`
    // clearing `error` at entry) -- otherwise a one-off network blip's error
    // message would stay on screen indefinitely even after polling recovers.
    error.set(null)

    const { status } = result.body as { status: 'approved' | 'pending' | 'denied' }
    if (status === 'pending') return

    stopPolling()

    if (status === 'denied') {
      mode.set('rejected')
      return
    }

    const loginResult = await wrap(
      completeLoginAfterApproval(registeredCredentialId ?? deps.storage.get()),
    )
    if (loginResult instanceof Error) {
      error.set(loginResult.message)
      return
    }

    deps.storage.set(loginResult.credentialId)
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

  const startRegistration = action(async () => {
    error.set(null)
    const currentToken = token()
    if (!currentToken) {
      error.set('Отсутствует код приглашения')
      return
    }

    const optionsResult = await wrap(
      postJson(deps.fetchImpl, '/api/auth/devices/register/options', { token: currentToken }),
    )
    if (optionsResult instanceof Error) {
      error.set(optionsResult.message)
      return
    }
    if (optionsResult.status !== 200) {
      error.set(`Не удалось получить параметры регистрации (код ${optionsResult.status})`)
      return
    }

    const { options } = optionsResult.body as {
      options: PublicKeyCredentialCreationOptionsJSON
    }

    const attestationResponse = await wrap(
      deps
        .startRegistrationCeremony({ optionsJSON: options })
        .catch((cause) => new AddDeviceError({ reason: 'сбой процедуры регистрации', cause })),
    )
    if (attestationResponse instanceof Error) {
      error.set(attestationResponse.message)
      return
    }

    const verifyResult = await wrap(
      postJson(deps.fetchImpl, '/api/auth/devices/register/verify', {
        token: currentToken,
        attestationResponse,
      }),
    )
    if (verifyResult instanceof Error) {
      error.set(verifyResult.message)
      return
    }
    if (verifyResult.status !== 200) {
      error.set(`Не удалось подтвердить регистрацию (код ${verifyResult.status})`)
      return
    }

    const { credentialId } = verifyResult.body as { credentialId: string }
    registeredCredentialId = credentialId
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
    mode.set('registering')
    // Wrapped even though nothing currently follows this await -- matches
    // this codebase's established convention for "action calling another
    // action" (see account/model/add-device-model.ts's
    // `await wrap(deps.accountModel.approve(...))`), so a future edit adding
    // logic after this line doesn't silently reintroduce a frame-escape bug.
    await wrap(startRegistration())
  }, 'addDevice.submitManual')

  return {
    token,
    mode,
    error,
    extractAddCode,
    submitManual,
    startRegistration,
    pollPendingStatus,
  }
}
