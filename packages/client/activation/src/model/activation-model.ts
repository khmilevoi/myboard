import {
  action,
  type Action,
  atom,
  type Atom,
  Computed,
  computed,
  reatomField,
  reatomForm,
  withAsync,
  wrap,
} from '@reatom/core'
import { HttpClient, type HttpLike } from '@shared/http/client'
import type { Navigate } from '@shared/navigation'
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'
import {
  startAuthentication as browserStartAuthentication,
  startRegistration as browserStartRegistration,
} from '@simplewebauthn/browser'
import * as errore from 'errore'

export const CRED_HINT_STORAGE_KEY = 'mb_cred_hint'

export type ActivationMode = 'new-account' | 'login'

export class ActivationError extends errore.createTaggedError({
  name: 'ActivationError',
  message: 'Ошибка активации: $reason',
}) {}

export interface ActivationStorage {
  get(): string | null
  set(credentialId: string): void
  clear(): void
}

export interface ActivationDeps {
  token: string | null
  navigate: Navigate
  storage: ActivationStorage
  http: HttpLike
  // Matches the real @simplewebauthn/browser signatures exactly (both take
  // a single `{ optionsJSON }` object, not the raw options), so a test
  // double stays call-compatible with the real ceremony.
  startRegistrationCeremony: typeof browserStartRegistration
  startAuthenticationCeremony: typeof browserStartAuthentication
}

function readTokenFromLocation(): string | null {
  if (typeof location === 'undefined') return null
  return new URLSearchParams(location.search).get('token')
}

// Stores only the last-used credentialId -- a *public*, non-secret WebAuthn
// identifier (it is sent to the server in every ceremony and lives in
// `allowCredentials`), used purely as a client-side login hint. It is not a
// session token or private key, so localStorage is the right home: it never
// needs to travel to the server (so no cookie), and a JS-readable cookie would
// carry no security advantage. The server never trusts this hint -- login is
// still verified against the stored public key + signature.
function defaultStorage(): ActivationStorage {
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

async function postJson(
  http: HttpLike,
  url: string,
  payload: unknown,
): Promise<ActivationError | JsonResult> {
  const res = await http.post(url, { json: payload })
  if (res instanceof Error) {
    return new ActivationError({ reason: 'сбой сетевого запроса', cause: res })
  }
  return { status: res.status, body: (res.body ?? {}) as Record<string, unknown> }
}

export interface ActivationModel {
  mode: Atom<ActivationMode>
  loading: Computed<boolean>
  error: Atom<string | null>
  registrationForm: ReturnType<typeof reatomForm<{ name: string }>>
  startRegistration: () => Promise<void>
  startLogin: Action<[], Promise<void>>
}

export function createActivationModel(overrides: Partial<ActivationDeps> = {}): ActivationModel {
  const deps: ActivationDeps = {
    token: overrides.token ?? readTokenFromLocation(),
    navigate: overrides.navigate ?? ((path) => window.location.assign(path)),
    storage: overrides.storage ?? defaultStorage(),
    http: overrides.http ?? new HttpClient(),
    startRegistrationCeremony: overrides.startRegistrationCeremony ?? browserStartRegistration,
    startAuthenticationCeremony:
      overrides.startAuthenticationCeremony ?? browserStartAuthentication,
  }

  const mode = atom<ActivationMode>('new-account', 'activation.mode')
  const error = atom<string | null>(null, 'activation.error')

  const registrationForm = reatomForm(
    {
      name: reatomField('', {
        name: 'activation.registrationForm.name',
        validate: ({ state }: { state: string }) => {
          if (!state.trim()) return 'Введите имя'
          if (state.length > 40) return 'Имя должно быть не длиннее 40 символов'
          return undefined
        },
      }),
    },
    {
      name: 'activation.registrationForm',
      onSubmit: async (state: { name: string }) => {
        // Submission in-flight state is owned by the form's `submit` action
        // (withAsyncData) -- read it via `registrationForm.submit.ready()`. We
        // only keep `error` here for the human-readable failure message, since
        // this flow returns errors (errore) instead of throwing.
        error.set(null)

        if (!deps.token) {
          error.set('Отсутствует токен приглашения')
          return
        }

        const optionsResult = await wrap(
          postJson(deps.http, '/api/auth/register/options', { token: deps.token }),
        )
        if (optionsResult instanceof Error) {
          error.set(optionsResult.message)
          return
        }
        if (optionsResult.status === 409 && optionsResult.body.code === 'invite_consumed') {
          mode.set('login')
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
          deps.startRegistrationCeremony({ optionsJSON: options }),
        ).catch((cause) => new ActivationError({ reason: 'сбой процедуры регистрации', cause }))
        if (attestationResponse instanceof Error) {
          error.set(attestationResponse.message)
          return
        }

        const verifyResult = await wrap(
          postJson(deps.http, '/api/auth/register/verify', {
            token: deps.token,
            name: state.name,
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
        deps.storage.set(credentialId)
        deps.navigate('/')
      },
    },
  )

  const startRegistration = () => registrationForm.submit().catch(() => undefined)

  // A single login attempt: options -> ceremony -> verify. `hintFailure: true` marks
  // failures that are plausibly caused by a stale/unavailable credential hint (the
  // ceremony can't find a matching credential, or the server rejects it), as opposed
  // to unrelated network/options failures that a hint retry wouldn't fix.
  type LoginAttemptResult =
    | { ok: true; credentialId: string }
    | { ok: false; hintFailure: boolean; message: string }

  async function attemptLogin(hint: string | null): Promise<LoginAttemptResult> {
    const optionsResult = await wrap(
      postJson(deps.http, '/api/auth/login/options', hint ? { credentialIdHint: hint } : {}),
    )
    if (optionsResult instanceof Error) {
      return { ok: false, hintFailure: false, message: optionsResult.message }
    }
    if (optionsResult.status !== 200) {
      return {
        ok: false,
        hintFailure: false,
        message: `Не удалось получить параметры входа (код ${optionsResult.status})`,
      }
    }

    const { options } = optionsResult.body as { options: PublicKeyCredentialRequestOptionsJSON }

    const authenticationResponse = await wrap(
      deps.startAuthenticationCeremony({ optionsJSON: options }),
    ).catch((cause) => new ActivationError({ reason: 'сбой процедуры аутентификации', cause }))
    if (authenticationResponse instanceof Error) {
      return { ok: false, hintFailure: true, message: authenticationResponse.message }
    }

    const verifyResult = await wrap(
      postJson(deps.http, '/api/auth/login/verify', { authenticationResponse }),
    )
    if (verifyResult instanceof Error) {
      return { ok: false, hintFailure: false, message: verifyResult.message }
    }
    if (verifyResult.status !== 200) {
      return {
        ok: false,
        hintFailure: true,
        message: `Не удалось подтвердить вход (код ${verifyResult.status})`,
      }
    }

    const { credentialId } = verifyResult.body as { credentialId: string }
    return { ok: true, credentialId }
  }

  const startLogin = action(async () => {
    error.set(null)

    const hint = deps.storage.get()
    const result = await attemptLogin(hint)

    // `NotAllowedError` covers both a stale/unavailable hinted credential AND a
    // deliberate user cancel -- we can't tell them apart. Silently firing a
    // second, unsolicited ceremony would surprise a user who just cancelled.
    // Instead: drop the (now-suspect) hint so it's not tried again, and let the
    // user decide whether to retry (which will then run hintless).
    if (hint !== null && !result.ok && result.hintFailure) {
      deps.storage.clear()
    }

    if (!result.ok) {
      error.set(result.message)
      return
    }

    deps.storage.set(result.credentialId)
    deps.navigate('/')
  }, 'activation.startLogin').extend(withAsync())

  // Unified in-flight flag for the UI: the registration form's submit action
  // and the login action each expose `ready()` (true when not loading); only
  // one is ever active at a time for a given mode.
  const loading = computed(
    () => !registrationForm.submit.ready() || !startLogin.ready(),
    'activation.loading',
  )

  return { mode, loading, error, registrationForm, startRegistration, startLogin }
}
