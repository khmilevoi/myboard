import { action, atom, wrap } from '@reatom/core'
import { HttpClient, type HttpLike } from '@shared/http/client'
import type { Navigate } from '@shared/navigation'
import { startAuthentication } from '@simplewebauthn/browser'
import { z } from 'zod'

// Same non-secret localStorage hint the activation app maintains
// (packages/client/activation/src/model/activation-model.ts).
export const CRED_HINT_STORAGE_KEY = 'mb_cred_hint'

// Envelope-level validation only: the inner options shape is the
// server ↔ @simplewebauthn contract, not this model's business.
const LoginOptionsEnvelopeSchema = z.object({ options: z.record(z.string(), z.unknown()) })

export interface ReloginDeps {
  http: HttpLike
  startAuthenticationCeremony: typeof startAuthentication
  navigate: Navigate
  credHint: { get(): string | null; clear(): void }
}

export interface ReloginModel {
  /** Single-flight session recovery: true — retry the failed request. */
  ensureSession: () => Promise<boolean>
}

function defaultCredHint(): ReloginDeps['credHint'] {
  return {
    get: () =>
      typeof localStorage === 'undefined' ? null : localStorage.getItem(CRED_HINT_STORAGE_KEY),
    clear: () => {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(CRED_HINT_STORAGE_KEY)
    },
  }
}

export function makeReloginModel(overrides: Partial<ReloginDeps> = {}): ReloginModel {
  const deps: ReloginDeps = {
    // Own bare client (no retry hook): the re-login path must never recurse
    // into itself; building it here also keeps runtime.ts → relogin.ts acyclic.
    http: overrides.http ?? new HttpClient(),
    startAuthenticationCeremony: overrides.startAuthenticationCeremony ?? startAuthentication,
    navigate: overrides.navigate ?? ((path) => window.location.assign(path)),
    credHint: overrides.credHint ?? defaultCredHint(),
  }

  const inflight = atom<Promise<boolean> | null>(null, 'relogin.inflight')

  async function run(): Promise<boolean> {
    // Probe first: distinguishes "session expired" (401 → ceremony) from
    // transport failures (offline-first: report false, change nothing) and
    // spurious per-endpoint 401s (200 → the session is fine, just retry).
    const probe = await deps.http.get('/api/auth/session')
    if (probe instanceof Error) return false
    if (probe.ok) return true
    if (probe.status !== 401) return false

    // No stored hint means this device never registered/logged in. Under the
    // real nginx gate a first-time anonymous visit never reaches this code
    // (nginx serves the activation page before the SPA loads), so this only
    // fires from an ungated dev/test context or a rare hint-cleared edge
    // case — either way, forcing a ceremony/hard-navigate from a background
    // probe is unnecessarily aggressive. Offline-first: report false, change
    // nothing; nginx's own auth_request check backstops the next navigation.
    const hint = deps.credHint.get()
    if (!hint) return false

    const bail = (): false => {
      deps.credHint.clear()
      // /activate/, not '/': the PWA service worker serves the cached board
      // shell for '/' (navigateFallback) — a revoked device would loop
      // through endless ceremonies. /activate/ is public and denylisted from
      // the SW fallback, so it always reaches nginx.
      deps.navigate('/activate/')
      return false
    }

    const optionsRes = await deps.http.post('/api/auth/login/options', {
      json: { credentialIdHint: hint },
    })
    if (optionsRes instanceof Error || !optionsRes.ok) return bail()

    const envelope = LoginOptionsEnvelopeSchema.safeParse(optionsRes.body)
    if (!envelope.success) return bail()
    const options = envelope.data.options as unknown as Parameters<
      typeof startAuthentication
    >[0]['optionsJSON']

    const assertion = await deps
      .startAuthenticationCeremony({ optionsJSON: options })
      .catch(() => null)
    if (assertion === null) return bail()

    const verifyRes = await deps.http.post('/api/auth/login/verify', {
      json: { authenticationResponse: assertion },
    })
    if (verifyRes instanceof Error || !verifyRes.ok) return bail()

    return true
  }

  const ensureSession = action(async () => {
    const existing = inflight()
    if (existing) return existing

    const clear = wrap(() => inflight.set(null))
    const promise = run().finally(clear)
    inflight.set(promise)
    return promise
  }, 'relogin.ensureSession')

  return { ensureSession: () => ensureSession() }
}
