import { parseCookie, stringifySetCookie } from 'cookie'

export type SerializeCookieOptions = {
  maxAgeMs?: number
  httpOnly?: boolean
  secure?: boolean
  sameSite: 'Lax' | 'Strict'
  path?: string
}

export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {}

  const result: Record<string, string> = {}
  for (const [name, value] of Object.entries(parseCookie(header))) {
    if (value !== undefined) result[name] = value
  }
  return result
}

export function serializeCookie(
  name: string,
  value: string,
  { maxAgeMs, httpOnly, secure, sameSite, path }: SerializeCookieOptions,
): string {
  return stringifySetCookie({
    name,
    value,
    path: path ?? '/',
    httpOnly,
    secure,
    sameSite: sameSite.toLowerCase() as 'lax' | 'strict',
    ...(maxAgeMs !== undefined ? { maxAge: Math.floor(maxAgeMs / 1000) } : {}),
  })
}

export function clearCookie(name: string, opts: SerializeCookieOptions): string {
  return serializeCookie(name, '', { ...opts, maxAgeMs: 0 })
}
