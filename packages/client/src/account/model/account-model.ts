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
import {
  prepareImage as prepareImageInBrowser,
  type SquareCrop,
} from 'widget-sdk/files/prepare-image'

import { purgeLocalSession } from '@/session/model/purge'

import { deleteAvatar, describeAvatarError, putAvatar } from './avatar-http'
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
  /**
   * Shrinks a picked photo to the avatar preset before upload — the given square, or the centred
   * one without it; injectable for tests.
   */
  prepareImage: (file: Blob, crop: SquareCrop | null) => Promise<Error | Blob>
  /**
   * Re-reads the board's member directory after an avatar change, so every widget showing this
   * account (Ofelia's MemberAvatar) picks the new photo up without a reload.
   */
  refreshIdentity: () => Promise<void>
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
  /**
   * Prepares, uploads and applies a new photo. The failure comes back as a value: the crop dialog
   * that drives this shows it as `describeAvatarError` copy (the crop model's `describeError`), so
   * nothing here records it.
   */
  uploadAvatar: Action<[Blob, SquareCrop | null], Promise<Error | null>>
  removeAvatar: Action<[], Promise<void>>
  /** True while an avatar upload or removal is in flight. */
  avatarPending: Computed<boolean>
  /** The last removal failure as user-facing copy; cleared by the next attempt. */
  removeAvatarError: Atom<string | null>
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
    prepareImage:
      overrides.prepareImage ??
      ((file, crop) => prepareImageInBrowser(file, 'avatar', crop === null ? {} : { crop })),
    refreshIdentity: overrides.refreshIdentity ?? (async () => {}),
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

  const removeAvatarError = atom<string | null>(null, 'account.removeAvatarError')

  // The account and every widget's member directory follow the change. The account is patched at
  // once so the menu shows the new photo before the refreshes return.
  const applyAvatar = action(async (avatarUrl: string | undefined) => {
    const current = account()
    if (current) {
      const { avatarUrl: _previous, ...rest } = current
      account.set(avatarUrl === undefined ? rest : { ...rest, avatarUrl })
    }
    await wrap(Promise.all([refresh(), deps.refreshIdentity()]))
  }, 'account.applyAvatar')

  const uploadAvatar = action(async (file: Blob, crop: SquareCrop | null) => {
    const prepared = await wrap(deps.prepareImage(file, crop))
    if (prepared instanceof Error) return prepared

    const ref = await wrap(putAvatar(deps.http, prepared))
    if (ref instanceof Error) return ref

    await wrap(applyAvatar(ref.url))
    return null
  }, 'account.uploadAvatar').extend(withAsync())

  const removeAvatar = action(async () => {
    removeAvatarError.set(null)

    const result = await wrap(deleteAvatar(deps.http))
    if (result instanceof Error) {
      removeAvatarError.set(describeAvatarError(result))
      return
    }

    await wrap(applyAvatar(undefined))
  }, 'account.removeAvatar').extend(withAsync())

  const avatarPending = computed(
    () => !uploadAvatar.ready() || !removeAvatar.ready(),
    'account.avatarPending',
  )

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
    uploadAvatar,
    removeAvatar,
    avatarPending,
    removeAvatarError,
    connectEvents,
  }
}
