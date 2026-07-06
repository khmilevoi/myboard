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
  fetchImpl: typeof fetch,
  url: string,
  options: RequestOptions = {},
): Promise<Error | T> {
  const headers: Record<string, string> = { 'X-Requested-With': 'MyBoard' }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'

  const res = await fetchImpl(url, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  }).catch((cause) => new DeviceHttpError({ reason: 'сбой сетевого запроса', cause }))
  if (res instanceof Error) return res

  // 204 No Content is the success response for deny/revoke/logout -- there is
  // no body to parse.
  if (res.status === 204) return undefined as T

  const body = await res
    .json()
    .catch((cause) => new DeviceHttpError({ reason: 'некорректный ответ сервера', cause }))
  if (body instanceof Error) return body

  if (!res.ok) {
    const code =
      typeof (body as { code?: unknown }).code === 'string'
        ? (body as { code: string }).code
        : 'unknown_error'
    return new DeviceApiError({ code, status: res.status })
  }

  return body as T
}

export function fetchAccount(fetchImpl: typeof fetch): Promise<Error | AccountDto> {
  return request<AccountDto>(fetchImpl, '/api/auth/account')
}

export function fetchDevices(fetchImpl: typeof fetch): Promise<Error | DevicesResult> {
  return request<DevicesResult>(fetchImpl, '/api/auth/devices')
}

export function approveDevice(
  fetchImpl: typeof fetch,
  credentialId: string,
): Promise<Error | { ok: true }> {
  return request<{ ok: true }>(
    fetchImpl,
    `/api/auth/devices/${encodeURIComponent(credentialId)}/approve`,
    { method: 'POST' },
  )
}

export function denyDevice(fetchImpl: typeof fetch, credentialId: string): Promise<Error | void> {
  return request<void>(fetchImpl, `/api/auth/devices/${encodeURIComponent(credentialId)}/deny`, {
    method: 'POST',
  })
}

export function revokeDevice(fetchImpl: typeof fetch, credentialId: string): Promise<Error | void> {
  return request<void>(fetchImpl, `/api/auth/devices/${encodeURIComponent(credentialId)}/revoke`, {
    method: 'POST',
  })
}

export function logout(fetchImpl: typeof fetch): Promise<Error | void> {
  return request<void>(fetchImpl, '/api/auth/logout', { method: 'POST' })
}
