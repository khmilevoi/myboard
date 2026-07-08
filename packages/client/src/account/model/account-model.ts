import {
  action,
  type Action,
  atom,
  type Atom,
  type Computed,
  computed,
  wrap,
  withAsync,
} from '@reatom/core'
import { HttpClient, type HttpLike } from '@shared/http/client'
import { makeEventSourceStream, type OpenEventStream } from '@shared/http/event-stream'

import { purgeLocalSession } from '@/session/model/purge'

import type { AccountDto, DeviceDto } from './devices-http'
import {
  approveDevice as approveDeviceRequest,
  denyDevice as denyDeviceRequest,
  describeDeviceError,
  fetchAccount,
  fetchDevices,
  logout as logoutRequest,
  revokeDevice as revokeDeviceRequest,
} from './devices-http'

// Duplicated (not imported) from packages/client/activation/src/model/activation-model.ts:
// the activation app and the board client are separate deployables that never
// import each other's `src`. Both run on the same origin and must agree on
// this literal localStorage key to identify "this device".
export const CRED_HINT_STORAGE_KEY = 'mb_cred_hint'

export interface AccountStorage {
  get(): string | null
}

export interface AccountDeps {
  http: HttpLike
  storage: AccountStorage
  navigate: (path: string) => void
  openEventStream: OpenEventStream
  /** Bare (no retry hook) client for logout: a dead session is already
   * logged out — running a WebAuthn ceremony in order to log out would be
   * absurd. A local `new HttpClient()` construction, so a default is fine
   * here (unlike `http` above, which a model must never default itself). */
  bareHttp: HttpLike
  /** Local-data hygiene on logout (Dexie, caches, service worker). */
  purge: () => Promise<void>
}

function defaultStorage(): AccountStorage {
  return {
    get: () =>
      typeof localStorage === 'undefined' ? null : localStorage.getItem(CRED_HINT_STORAGE_KEY),
  }
}

type DeviceEventMessage = { type: string; credentialId: string; label?: string }

function parseDeviceEventMessage(raw: string): DeviceEventMessage | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || !('value' in parsed)) return null
  const value = (parsed as { value: unknown }).value
  if (typeof value !== 'object' || value === null) return null
  const { type } = value as { type?: unknown }
  if (typeof type !== 'string' || !type.startsWith('device-')) return null
  return value as DeviceEventMessage
}

export interface AccountModel {
  account: Atom<AccountDto | null>
  devices: Atom<DeviceDto[]>
  pending: Computed<DeviceDto[]>
  thisCredentialId: Atom<string | null>
  loading: Computed<boolean>
  error: Atom<string | null>
  refresh: Action<[], Promise<void>>
  approve: Action<[string], Promise<void>>
  deny: Action<[string], Promise<void>>
  revoke: Action<[string], Promise<void>>
  logout: Action<[], Promise<void>>
  connectEvents: () => () => void
}

export function createAccountModel(
  overrides: Partial<AccountDeps> & { http: HttpLike },
): AccountModel {
  const deps: AccountDeps = {
    http: overrides.http,
    storage: overrides.storage ?? defaultStorage(),
    navigate: overrides.navigate ?? ((path) => window.location.assign(path)),
    openEventStream: overrides.openEventStream ?? makeEventSourceStream(),
    bareHttp: overrides.bareHttp ?? new HttpClient(),
    purge: overrides.purge ?? purgeLocalSession,
  }

  const account = atom<AccountDto | null>(null, 'account.account')
  const devices = atom<DeviceDto[]>([], 'account.devices')
  const error = atom<string | null>(null, 'account.error')
  const thisCredentialId = atom<string | null>(deps.storage.get(), 'account.thisCredentialId')

  const pending = computed(
    () => devices().filter((device) => device.status === 'pending'),
    'account.pending',
  )

  const refresh = action(async () => {
    error.set(null)

    const accountResult = await wrap(fetchAccount(deps.http))
    if (accountResult instanceof Error) {
      error.set(describeDeviceError(accountResult))
      return
    }

    const devicesResult = await wrap(fetchDevices(deps.http))
    if (devicesResult instanceof Error) {
      error.set(describeDeviceError(devicesResult))
      return
    }

    account.set(accountResult)
    devices.set(devicesResult.devices)
    // The server derives thisCredentialId from the live session
    // (session.credentialId in getDevices) -- authoritative over the
    // localStorage hint, which only seeds the atom before the first refresh
    // and is a fallback if the server ever omits the field.
    thisCredentialId.set(devicesResult.thisCredentialId ?? deps.storage.get())
  }, 'account.refresh').extend(withAsync())

  const approve = action(async (credentialId: string) => {
    error.set(null)

    const result = await wrap(approveDeviceRequest(deps.http, credentialId))
    if (result instanceof Error) {
      error.set(describeDeviceError(result))
      return
    }

    await wrap(refresh())
  }, 'account.approve').extend(withAsync())

  const deny = action(async (credentialId: string) => {
    error.set(null)

    const result = await wrap(denyDeviceRequest(deps.http, credentialId))
    if (result instanceof Error) {
      error.set(describeDeviceError(result))
      return
    }

    await wrap(refresh())
  }, 'account.deny').extend(withAsync())

  const revoke = action(async (credentialId: string) => {
    error.set(null)

    const result = await wrap(revokeDeviceRequest(deps.http, credentialId))
    if (result instanceof Error) {
      error.set(describeDeviceError(result))
      return
    }

    await wrap(refresh())
  }, 'account.revoke').extend(withAsync())

  const logout = action(async () => {
    error.set(null)

    // Bare client deliberately: a dead session is already logged out — running
    // a WebAuthn ceremony in order to log out would be absurd.
    const result = await wrap(logoutRequest(deps.bareHttp))
    if (result instanceof Error) {
      error.set(describeDeviceError(result))
      return
    }

    await wrap(deps.purge().catch(() => undefined))
    // '/' is safe here (unlike relogin's bail): purge just unregistered the
    // service worker, so this navigation reaches nginx and gets the 401
    // activation page.
    deps.navigate('/')
  }, 'account.logout').extend(withAsync())

  const loading = computed(
    () => !refresh.ready() || !approve.ready() || !deny.ready() || !revoke.ready(),
    'account.loading',
  )

  // No re-auth reconnect here — deliberate asymmetry with the storage SSE
  // manager: device events live only while the devices dialog is open, and
  // every action in that dialog goes through the retry-hooked `http`, which
  // heals the session by itself.
  function connectEvents(): () => void {
    const stream = deps.openEventStream('/api/auth/devices/events', {
      onMessage: wrap((message) => {
        const parsed = parseDeviceEventMessage(message.data)
        if (parsed) void refresh()
      }),
    })
    return () => stream.close()
  }

  return {
    account,
    devices,
    pending,
    thisCredentialId,
    loading,
    error,
    refresh,
    approve,
    deny,
    revoke,
    logout,
    connectEvents,
  }
}
