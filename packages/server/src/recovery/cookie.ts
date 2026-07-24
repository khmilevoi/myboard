import { serializeCookie } from '../auth/cookies'

// `__Host-` is unavailable here: it demands Path=/, and this cookie is
// deliberately scoped to the recovery routes. `__Secure-` allows a narrow path
// and still requires HTTPS; a plain-http dev origin drops the prefix, exactly
// like the auth cookies do.
const SECURE_COOKIE_NAME = '__Secure-mb_recovery'
const INSECURE_COOKIE_NAME = 'mb_recovery'

export const RECOVERY_COOKIE_PATH = '/api/browser/recovery'

export function recoveryCookieName(secureCookies: boolean): string {
  return secureCookies ? SECURE_COOKIE_NAME : INSECURE_COOKIE_NAME
}

export function serializeRecoveryCookie(args: {
  token: string
  ttlMs: number
  secureCookies: boolean
}): string {
  return serializeCookie(recoveryCookieName(args.secureCookies), args.token, {
    maxAgeMs: args.ttlMs,
    httpOnly: true,
    secure: args.secureCookies,
    sameSite: 'Strict',
    path: RECOVERY_COOKIE_PATH,
  })
}
