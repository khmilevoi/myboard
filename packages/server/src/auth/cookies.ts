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
  for (const pair of header.split('; ')) {
    const separatorIndex = pair.indexOf('=')
    if (separatorIndex === -1) continue
    const name = pair.slice(0, separatorIndex)
    const value = pair.slice(separatorIndex + 1)
    result[name] = decodeURIComponent(value)
  }
  return result
}

export function serializeCookie(
  name: string,
  value: string,
  { maxAgeMs, httpOnly, secure, sameSite, path }: SerializeCookieOptions,
): string {
  const parts = [`${name}=${value}`]

  if (maxAgeMs !== undefined) parts.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`)
  parts.push(`Path=${path ?? '/'}`)
  if (httpOnly) parts.push('HttpOnly')
  if (secure) parts.push('Secure')
  parts.push(`SameSite=${sameSite}`)

  return parts.join('; ')
}

export function clearCookie(name: string, opts: SerializeCookieOptions): string {
  return serializeCookie(name, '', { ...opts, maxAgeMs: 0 })
}
