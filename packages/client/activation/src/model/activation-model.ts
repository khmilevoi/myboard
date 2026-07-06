import { action, atom, reatomField, reatomForm, wrap, type Action, type Atom } from '@reatom/core'
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
export type ActivationStatus = 'idle' | 'pending' | 'error'

export class ActivationError extends errore.createTaggedError({
  name: 'ActivationError',
  message: 'Activation request failed: $reason',
}) {}

export interface ActivationStorage {
  get(): string | null
  set(credentialId: string): void
  clear(): void
}

export interface ActivationDeps {
  token: string | null
  navigate: (path: string) => void
  storage: ActivationStorage
  fetchImpl: typeof fetch
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
  fetchImpl: typeof fetch,
  url: string,
  payload: unknown,
): Promise<ActivationError | JsonResult> {
  const res = await fetchImpl(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'MyBoard',
    },
    body: JSON.stringify(payload),
  }).catch((cause) => new ActivationError({ reason: 'network request failed', cause }))
  if (res instanceof Error) return res

  const body = await res
    .json()
    .catch((cause) => new ActivationError({ reason: 'invalid JSON response', cause }))
  if (body instanceof Error) return body as ActivationError

  return { status: res.status, body: body as Record<string, unknown> }
}

export interface ActivationModel {
  mode: Atom<ActivationMode>
  status: Atom<ActivationStatus>
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
    fetchImpl: overrides.fetchImpl ?? fetch,
    startRegistrationCeremony: overrides.startRegistrationCeremony ?? browserStartRegistration,
    startAuthenticationCeremony:
      overrides.startAuthenticationCeremony ?? browserStartAuthentication,
  }

  const mode = atom<ActivationMode>('new-account', 'activation.mode')
  const status = atom<ActivationStatus>('idle', 'activation.status')
  const error = atom<string | null>(null, 'activation.error')

  const registrationForm = reatomForm(
    {
      name: reatomField('', {
        name: 'activation.registrationForm.name',
        validate: ({ state }: { state: string }) => {
          if (!state.trim()) return 'Name is required'
          if (state.length > 40) return 'Name must be 40 characters or fewer'
          return undefined
        },
      }),
    },
    {
      name: 'activation.registrationForm',
      onSubmit: async (state: { name: string }) => {
        status.set('pending')
        error.set(null)

        if (!deps.token) {
          status.set('error')
          error.set('Missing invitation token')
          return
        }

        const optionsResult = await wrap(
          postJson(deps.fetchImpl, '/api/auth/register/options', { token: deps.token }),
        )
        if (optionsResult instanceof Error) {
          status.set('error')
          error.set(optionsResult.message)
          return
        }
        if (optionsResult.status === 409 && optionsResult.body.code === 'invite_consumed') {
          mode.set('login')
          status.set('idle')
          return
        }
        if (optionsResult.status !== 200) {
          status.set('error')
          error.set(`register/options failed with status ${optionsResult.status}`)
          return
        }

        const { options } = optionsResult.body as {
          options: PublicKeyCredentialCreationOptionsJSON
        }

        const attestationResponse = await wrap(
          deps.startRegistrationCeremony({ optionsJSON: options }),
        ).catch((cause) => new ActivationError({ reason: 'registration ceremony failed', cause }))
        if (attestationResponse instanceof Error) {
          status.set('error')
          error.set(attestationResponse.message)
          return
        }

        const verifyResult = await wrap(
          postJson(deps.fetchImpl, '/api/auth/register/verify', {
            token: deps.token,
            name: state.name,
            attestationResponse,
          }),
        )
        if (verifyResult instanceof Error) {
          status.set('error')
          error.set(verifyResult.message)
          return
        }
        if (verifyResult.status !== 200) {
          status.set('error')
          error.set(`register/verify failed with status ${verifyResult.status}`)
          return
        }

        const { credentialId } = verifyResult.body as { credentialId: string }
        deps.storage.set(credentialId)
        status.set('idle')
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
      postJson(deps.fetchImpl, '/api/auth/login/options', hint ? { credentialIdHint: hint } : {}),
    )
    if (optionsResult instanceof Error) {
      return { ok: false, hintFailure: false, message: optionsResult.message }
    }
    if (optionsResult.status !== 200) {
      return {
        ok: false,
        hintFailure: false,
        message: `login/options failed with status ${optionsResult.status}`,
      }
    }

    const { options } = optionsResult.body as { options: PublicKeyCredentialRequestOptionsJSON }

    const authenticationResponse = await wrap(
      deps.startAuthenticationCeremony({ optionsJSON: options }),
    ).catch((cause) => new ActivationError({ reason: 'authentication ceremony failed', cause }))
    if (authenticationResponse instanceof Error) {
      return { ok: false, hintFailure: true, message: authenticationResponse.message }
    }

    const verifyResult = await wrap(
      postJson(deps.fetchImpl, '/api/auth/login/verify', { authenticationResponse }),
    )
    if (verifyResult instanceof Error) {
      return { ok: false, hintFailure: false, message: verifyResult.message }
    }
    if (verifyResult.status !== 200) {
      return {
        ok: false,
        hintFailure: true,
        message: `login/verify failed with status ${verifyResult.status}`,
      }
    }

    const { credentialId } = verifyResult.body as { credentialId: string }
    return { ok: true, credentialId }
  }

  const startLogin = action(async () => {
    status.set('pending')
    error.set(null)

    const hint = deps.storage.get()
    const first = await attemptLogin(hint)

    const result =
      hint !== null && !first.ok && first.hintFailure
        ? await (() => {
            deps.storage.clear()
            return attemptLogin(null)
          })()
        : first

    if (!result.ok) {
      status.set('error')
      error.set(result.message)
      return
    }

    deps.storage.set(result.credentialId)
    status.set('idle')
    deps.navigate('/')
  }, 'activation.startLogin')

  return { mode, status, error, registrationForm, startRegistration, startLogin }
}
