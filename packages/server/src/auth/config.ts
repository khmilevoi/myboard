import * as errore from 'errore'
import { z } from 'zod'

export type AuthConfig = {
  rpID: string
  rpName: string
  expectedOrigin: string
  sessionCookieName: string
  challengeCookieName: string
  pendingCookieName: string
  sessionTtlSlidingMs: number
  sessionTtlAbsoluteMs: number
  secureCookies: boolean
  trustCfConnectingIp: boolean
}

export class AuthConfigError extends errore.createTaggedError({
  name: 'AuthConfigError',
  message: 'Invalid auth configuration for $field',
}) {}

export class DurationParseError extends errore.createTaggedError({
  name: 'DurationParseError',
  message: 'Invalid duration string: $value',
}) {}

const DURATION_UNIT_MS: Record<string, number> = {
  d: 86_400_000,
  h: 3_600_000,
  m: 60_000,
  s: 1_000,
}

const DURATION_PATTERN = /^(\d+)(d|h|m|s)$/

export function parseDuration(value: string): number | DurationParseError {
  const match = DURATION_PATTERN.exec(value)
  if (!match) return new DurationParseError({ value })
  const [, amount, unit] = match
  return Number(amount) * DURATION_UNIT_MS[unit]
}

const DEFAULT_SESSION_COOKIE_NAME = '__Host-mb_session'
const CHALLENGE_COOKIE_BASE_NAME = '__Host-mb_chal'
const PENDING_COOKIE_BASE_NAME = '__Host-mb_pending'
const HOST_COOKIE_PREFIX = '__Host-'

function withDefault(fallback: string) {
  return (value: unknown) => (value === undefined || value === '' ? fallback : value)
}

const durationSchema = z.string().transform((value, ctx) => {
  const result = parseDuration(value)
  if (result instanceof Error) {
    ctx.addIssue({ code: 'custom', message: result.message })
    return z.NEVER
  }
  return result
})

// `z.url()` is the non-deprecated top-level replacement for the removed
// `z.string().url()` method. It accepts localhost (unlike `z.httpUrl()`, which
// requires a public domain), so the dev origin still validates; the refine
// keeps the http/https-only restriction.
const originSchema = z
  .url()
  .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol))

const ConfigSchema = z.object({
  RP_ID: z.string().min(1),
  RP_NAME: z.string().min(1),
  EXPECTED_ORIGIN: originSchema,
  SESSION_COOKIE_NAME: z.preprocess(withDefault(DEFAULT_SESSION_COOKIE_NAME), z.string().min(1)),
  SESSION_TTL_SLIDING: z.preprocess(withDefault('30d'), durationSchema),
  SESSION_TTL_ABSOLUTE: z.preprocess(withDefault('90d'), durationSchema),
  TRUST_CF_CONNECTING_IP: z.preprocess(withDefault('0'), z.enum(['0', '1'])),
})

function stripHostPrefix(name: string, secureCookies: boolean): string {
  if (secureCookies) return name
  if (!name.startsWith(HOST_COOKIE_PREFIX)) return name
  return name.slice(HOST_COOKIE_PREFIX.length)
}

export function loadAuthConfig(env: NodeJS.ProcessEnv): AuthConfig | AuthConfigError {
  const parsed = ConfigSchema.safeParse(env)
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path.join('.') || 'configuration'
    return new AuthConfigError({ field })
  }

  const secureCookies = new URL(parsed.data.EXPECTED_ORIGIN).protocol === 'https:'

  return {
    rpID: parsed.data.RP_ID,
    rpName: parsed.data.RP_NAME,
    expectedOrigin: parsed.data.EXPECTED_ORIGIN,
    sessionCookieName: stripHostPrefix(parsed.data.SESSION_COOKIE_NAME, secureCookies),
    challengeCookieName: stripHostPrefix(CHALLENGE_COOKIE_BASE_NAME, secureCookies),
    pendingCookieName: stripHostPrefix(PENDING_COOKIE_BASE_NAME, secureCookies),
    sessionTtlSlidingMs: parsed.data.SESSION_TTL_SLIDING,
    sessionTtlAbsoluteMs: parsed.data.SESSION_TTL_ABSOLUTE,
    secureCookies,
    trustCfConnectingIp: parsed.data.TRUST_CF_CONNECTING_IP === '1',
  }
}
