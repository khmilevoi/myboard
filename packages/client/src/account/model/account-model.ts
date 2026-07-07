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
  fetchImpl: typeof fetch
  storage: AccountStorage
  navigate: (path: string) => void
  eventSourceCtor?: typeof EventSource
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

export function createAccountModel(overrides: Partial<AccountDeps> = {}): AccountModel {
  const deps: AccountDeps = {
    fetchImpl: overrides.fetchImpl ?? fetch,
    storage: overrides.storage ?? defaultStorage(),
    navigate: overrides.navigate ?? ((path) => window.location.assign(path)),
    eventSourceCtor:
      overrides.eventSourceCtor ?? (globalThis as { EventSource?: typeof EventSource }).EventSource,
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

    const accountResult = await wrap(fetchAccount(deps.fetchImpl))
    if (accountResult instanceof Error) {
      error.set(describeDeviceError(accountResult))
      return
    }

    const devicesResult = await wrap(fetchDevices(deps.fetchImpl))
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

    const result = await wrap(approveDeviceRequest(deps.fetchImpl, credentialId))
    if (result instanceof Error) {
      error.set(describeDeviceError(result))
      return
    }

    await wrap(refresh())
  }, 'account.approve').extend(withAsync())

  const deny = action(async (credentialId: string) => {
    error.set(null)

    const result = await wrap(denyDeviceRequest(deps.fetchImpl, credentialId))
    if (result instanceof Error) {
      error.set(describeDeviceError(result))
      return
    }

    await wrap(refresh())
  }, 'account.deny').extend(withAsync())

  const revoke = action(async (credentialId: string) => {
    error.set(null)

    const result = await wrap(revokeDeviceRequest(deps.fetchImpl, credentialId))
    if (result instanceof Error) {
      error.set(describeDeviceError(result))
      return
    }

    await wrap(refresh())
  }, 'account.revoke').extend(withAsync())

  const logout = action(async () => {
    error.set(null)

    const result = await wrap(logoutRequest(deps.fetchImpl))
    if (result instanceof Error) {
      error.set(describeDeviceError(result))
      return
    }

    deps.navigate('/')
  }, 'account.logout').extend(withAsync())

  const loading = computed(
    () => !refresh.ready() || !approve.ready() || !deny.ready() || !revoke.ready(),
    'account.loading',
  )

  function connectEvents(): () => void {
    const EventSourceCtor = deps.eventSourceCtor
    if (!EventSourceCtor) return () => {}

    const source = new EventSourceCtor('/api/auth/devices/events')
    source.onmessage = wrap((event: MessageEvent) => {
      const message = parseDeviceEventMessage(event.data as string)
      if (message) void refresh()
    })

    return () => source.close()
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
