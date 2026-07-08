import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'
import type { HttpLike } from '@shared/http/client'
import * as errore from 'errore'

export type AccountDto = {
  id: string
  name: string
  deviceLimit: number
}

export type DeviceDto = {
  credentialId: string
  label: string
  status: 'active' | 'pending'
  addedVia: 'invite' | 'add-token'
  createdAt: number
  lastSeenAt: number
}

export type DevicesResult = {
  devices: DeviceDto[]
  thisCredentialId: string
}

// Network/transport failures -- the request never produced a usable server
// response (rejected fetch, or a body that isn't valid JSON).
export class DeviceHttpError extends errore.createTaggedError({
  name: 'DeviceHttpError',
  message: 'Не удалось выполнить запрос устройств: $reason',
}) {}

// A well-formed non-2xx server response. Carries the errore-style `code` from
// the JSON body (see packages/server/src/auth/errors.ts's `AuthError.code`)
// so callers can map it to a user-facing message without string-matching.
export class DeviceApiError extends errore.createTaggedError({
  name: 'DeviceApiError',
  message: 'Запрос устройств завершился ошибкой $code (статус $status)',
}) {}

type RequestOptions = {
  method?: 'GET' | 'POST'
  body?: unknown
}

async function request<T>(
  http: HttpLike,
  url: string,
  options: RequestOptions = {},
): Promise<Error | T> {
  const res =
    options.method === 'POST'
      ? await http.post(url, options.body !== undefined ? { json: options.body } : undefined)
      : await http.get(url)
  if (res instanceof Error) {
    return new DeviceHttpError({ reason: 'сбой сетевого запроса', cause: res })
  }

  // 204 No Content is the success response for deny/revoke/logout.
  if (res.status === 204) return undefined as T

  if (!res.ok) {
    const code =
      typeof (res.body as { code?: unknown } | undefined)?.code === 'string'
        ? (res.body as { code: string }).code
        : 'unknown_error'
    return new DeviceApiError({ code, status: res.status })
  }

  return res.body as T
}

export function fetchAccount(http: HttpLike): Promise<Error | AccountDto> {
  return request<AccountDto>(http, '/api/auth/account')
}

export function fetchDevices(http: HttpLike): Promise<Error | DevicesResult> {
  return request<DevicesResult>(http, '/api/auth/devices')
}

export function approveDevice(
  http: HttpLike,
  credentialId: string,
): Promise<Error | { ok: true }> {
  return request<{ ok: true }>(
    http,
    `/api/auth/devices/${encodeURIComponent(credentialId)}/approve`,
    { method: 'POST' },
  )
}

export function denyDevice(http: HttpLike, credentialId: string): Promise<Error | void> {
  return request<void>(http, `/api/auth/devices/${encodeURIComponent(credentialId)}/deny`, {
    method: 'POST',
  })
}

export function revokeDevice(http: HttpLike, credentialId: string): Promise<Error | void> {
  return request<void>(http, `/api/auth/devices/${encodeURIComponent(credentialId)}/revoke`, {
    method: 'POST',
  })
}

export function logout(http: HttpLike): Promise<Error | void> {
  return request<void>(http, '/api/auth/logout', { method: 'POST' })
}

// Maps the server's errore `code` (packages/server/src/auth/errors.ts) to
// Russian, user-facing copy (Plan 2 constraint: all new-surface UI copy is
// Russian). Unknown codes fall back to a generic message that still surfaces
// the code for debugging. Shared by account-model.ts and add-device-model.ts
// so the same server error code always shows the same message regardless of
// which flow (device management vs. the add-device ceremony) surfaced it.
export const DEVICE_ERROR_MESSAGES: Record<string, string> = {
  last_active_device: 'Нельзя отозвать последнее активное устройство аккаунта',
  device_limit: 'Достигнут лимит устройств аккаунта',
  not_authorized: 'Недостаточно прав для этого действия',
  device_not_found: 'Устройство не найдено',
  device_disabled: 'Это устройство отключено',
  // packages/server/src/auth/session-guard.ts returns this (401) whenever the
  // session cookie is missing/expired/invalid on any session-gated endpoint.
  session_missing: 'Сессия истекла, войдите снова',
  account_not_found: 'Аккаунт не найден',
}

export function describeDeviceError(err: Error): string {
  if (err instanceof DeviceApiError) {
    return DEVICE_ERROR_MESSAGES[err.code] ?? `Не удалось выполнить действие (код ${err.code})`
  }
  return err.message
}

export type AddTokenOptionsResult = {
  options: PublicKeyCredentialRequestOptionsJSON
}

// Mirrors packages/server/src/auth/device-handlers.ts's postAddTokenOptions:
// a fresh-UV re-authentication challenge for the already-signed-in device
// ("device A") that is about to mint an add-device code. No request body --
// the account is derived from the live session.
export function fetchAddTokenOptions(http: HttpLike): Promise<Error | AddTokenOptionsResult> {
  return request<AddTokenOptionsResult>(http, '/api/auth/devices/add-token/options', {
    method: 'POST',
  })
}

export type AddTokenResult = {
  code: string
  formatted: string
  url: string
  expiresAt: number
}

// Mirrors postAddToken: verifies the fresh-UV assertion and mints a
// short-lived add-device code/URL for "device B" to consume.
export function mintAddToken(
  http: HttpLike,
  authenticationResponse: AuthenticationResponseJSON,
): Promise<Error | AddTokenResult> {
  return request<AddTokenResult>(http, '/api/auth/devices/add-token', {
    method: 'POST',
    body: { authenticationResponse },
  })
}
