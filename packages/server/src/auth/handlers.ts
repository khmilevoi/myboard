import type { IncomingMessage } from 'node:http'

import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
} from '@simplewebauthn/server'

import { readJsonBody } from '../http/body'
import { clientIp } from '../http/client-ip'
import { runExclusive } from '../storage/key-lock'
import { formatZodError } from '../storage/schemas'
import type { ValkeyOps } from '../storage/valkey'
import { addDeviceToAccount, createAccount } from './accounts'
import { consumeChallenge, saveChallenge } from './challenge-store'
import type { AuthConfig } from './config'
import { clearCookie, parseCookies, serializeCookie } from './cookies'
import { getDevice, listAllDeviceCredentialIds, storeDevice, updateSignCount } from './devices'
import { ChallengeInvalidError, DeviceDisabledError, InviteConsumedError } from './errors'
import type { PublicAuthError } from './errors'
import { consumeInvite, lookupInvite, recordInviteFailure, releaseInvite } from './invites'
import { accountDevicesKey, accountKey, deviceKey } from './records'
import {
  LoginOptionsBodySchema,
  LoginVerifyBodySchema,
  RegisterOptionsBodySchema,
  RegisterVerifyBodySchema,
} from './schemas'
import { issueSession, revokeSession, verifySession } from './sessions'
import { randomId, sha256hex } from './tokens'
import {
  buildAuthenticationOptions,
  buildRegistrationOptions,
  verifyAuthentication,
  verifyRegistration,
} from './webauthn'

export type AuthDeps = {
  ops: ValkeyOps
  config: AuthConfig
  now: () => number
}

export type AuthResult = {
  status: number
  body?: unknown
  headers?: Record<string, string | string[]>
}

const BROWSER_PATTERNS: Array<[RegExp, string]> = [
  [/Edg\//, 'Edge'],
  [/OPR\//, 'Opera'],
  [/Chrome\//, 'Chrome'],
  [/Firefox\//, 'Firefox'],
  [/Safari\//, 'Safari'],
]

const OS_PATTERNS: Array<[RegExp, string]> = [
  [/Windows/, 'Windows'],
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Mac OS X/, 'macOS'],
  [/Android/, 'Android'],
  [/Linux/, 'Linux'],
]

function detect(ua: string, patterns: Array<[RegExp, string]>): string | undefined {
  for (const [pattern, label] of patterns) {
    if (pattern.test(ua)) return label
  }
  return undefined
}

export function deviceLabelFromUa(ua: string | undefined): string {
  if (!ua) return 'Board device'

  const browser = detect(ua, BROWSER_PATTERNS)
  const os = detect(ua, OS_PATTERNS)

  if (browser && os) return `${browser} on ${os}`
  if (browser) return browser
  if (os) return os
  return 'Board device'
}

function isPublicAuthError(err: unknown): err is PublicAuthError {
  return (
    err instanceof Error &&
    typeof (err as { status?: unknown }).status === 'number' &&
    typeof (err as { code?: unknown }).code === 'string'
  )
}

export function toAuthResult(err: Error): AuthResult {
  if (isPublicAuthError(err)) return { status: err.status, body: { code: err.code } }
  return { status: 500, body: { code: 'internal_error' } }
}

function sessionCookieFor(config: AuthConfig, sessionId: string, maxAgeMs: number): string {
  return serializeCookie(config.sessionCookieName, sessionId, {
    maxAgeMs,
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'Lax',
    path: '/',
  })
}

function clearedSessionCookie(config: AuthConfig): string {
  return clearCookie(config.sessionCookieName, {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'Lax',
    path: '/',
  })
}

export function clearedChallengeCookie(config: AuthConfig): string {
  return clearCookie(config.challengeCookieName, {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'Strict',
    path: '/',
  })
}

function readSessionId(
  config: AuthConfig,
  req: Pick<IncomingMessage, 'headers'>,
): string | undefined {
  return parseCookies(req.headers.cookie)[config.sessionCookieName]
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  return readJsonBody(req).catch(() => undefined)
}

export async function postRegisterOptions(
  deps: AuthDeps,
  req: IncomingMessage,
): Promise<AuthResult> {
  const parsed = RegisterOptionsBodySchema.safeParse(await readBody(req))
  if (!parsed.success) return { status: 422, body: formatZodError(parsed.error) }
  const { token } = parsed.data

  const invite = await lookupInvite(deps.ops, deps.now, token)
  if (invite instanceof InviteConsumedError) {
    return { status: 409, body: { code: 'invite_consumed', canLogin: true } }
  }
  if (invite instanceof Error) return toAuthResult(invite)

  const excludeIds = await listAllDeviceCredentialIds(deps.ops)
  const displayName = invite.label ?? 'Board device'

  const options = await buildRegistrationOptions(deps.config, {
    userId: randomId(16),
    userName: displayName,
    userDisplayName: displayName,
    excludeCredentials: excludeIds.map((id) => ({ id })),
  })

  const { cookie } = await saveChallenge(deps.ops, deps.config, deps.now, {
    type: 'reg',
    challenge: options.challenge,
    inviteHash: sha256hex(token),
  })

  return { status: 200, body: { options }, headers: { 'Set-Cookie': cookie } }
}

export async function postRegisterVerify(
  deps: AuthDeps,
  req: IncomingMessage,
): Promise<AuthResult> {
  const parsed = RegisterVerifyBodySchema.safeParse(await readBody(req))
  if (!parsed.success) return { status: 422, body: formatZodError(parsed.error) }
  const { token, name, attestationResponse } = parsed.data

  const fail = async (err: Error): Promise<AuthResult> => {
    await recordInviteFailure(deps.ops, deps.now, token)
    return toAuthResult(err)
  }

  const challenge = await consumeChallenge(deps.ops, deps.config, deps.now, {
    cookieHeader: req.headers.cookie,
    expectedType: 'reg',
  })
  if (challenge instanceof Error) return fail(challenge)
  if (challenge.inviteHash !== sha256hex(token)) return fail(new ChallengeInvalidError())

  const verified = await verifyRegistration(deps.config, {
    response: attestationResponse as unknown as RegistrationResponseJSON,
    expectedChallenge: challenge.challenge,
  })
  if (verified instanceof Error) return fail(verified)

  const invite = await consumeInvite(deps.ops, deps.now, token)
  if (invite instanceof Error) return fail(invite)

  // The invite is now spent (consumeInvite above). From here on, any failure
  // must roll the invite back (releaseInvite) so the invitee isn't permanently
  // locked out with a burned invite and no usable account/device (see H2).
  const account = await createAccount(deps.ops, deps.now, { name, inviteId: invite.id })

  // Runs before storeDevice so a device-limit failure leaves no orphaned device
  // record behind -- only the (empty, about-to-be-deleted) fresh account.
  const addResult = await addDeviceToAccount(deps.ops, account.id, verified.credentialId, {
    countsAgainstLimit: true,
  })
  if (addResult instanceof Error) {
    await deps.ops.del(accountKey(account.id))
    await deps.ops.del(accountDevicesKey(account.id))
    await releaseInvite(deps.ops, deps.now, token)
    return toAuthResult(addResult)
  }

  const label = deviceLabelFromUa(req.headers['user-agent'])
  const createdAt = deps.now()
  await storeDevice(deps.ops, {
    credentialId: verified.credentialId,
    publicKey: verified.publicKey,
    signCount: verified.signCount,
    ...(verified.transports ? { transports: verified.transports } : {}),
    label,
    createdAt,
    lastSeenAt: createdAt,
    disabled: false,
    accountId: account.id,
    status: 'active',
    addedVia: 'invite',
    inviteId: invite.id,
  })

  const session = await issueSession(deps.ops, deps.config, deps.now, {
    accountId: account.id,
    credentialId: verified.credentialId,
    ...(clientIp(req) ? { ip: clientIp(req) as string } : {}),
    ...(req.headers['user-agent'] ? { ua: req.headers['user-agent'] } : {}),
  })

  return {
    status: 200,
    body: { accountId: account.id, credentialId: verified.credentialId },
    headers: {
      'Set-Cookie': [
        sessionCookieFor(deps.config, session.sessionId, deps.config.sessionTtlSlidingMs),
        clearedChallengeCookie(deps.config),
      ],
    },
  }
}

export async function postLoginOptions(deps: AuthDeps, req: IncomingMessage): Promise<AuthResult> {
  const parsed = LoginOptionsBodySchema.safeParse((await readBody(req)) ?? {})
  if (!parsed.success) return { status: 422, body: formatZodError(parsed.error) }

  const allowCredentials = parsed.data.credentialIdHint
    ? [{ id: parsed.data.credentialIdHint }]
    : undefined

  const options = await buildAuthenticationOptions(deps.config, { allowCredentials })

  const { cookie } = await saveChallenge(deps.ops, deps.config, deps.now, {
    type: 'auth',
    challenge: options.challenge,
  })

  return { status: 200, body: { options }, headers: { 'Set-Cookie': cookie } }
}

export async function postLoginVerify(deps: AuthDeps, req: IncomingMessage): Promise<AuthResult> {
  const parsed = LoginVerifyBodySchema.safeParse(await readBody(req))
  if (!parsed.success) return { status: 422, body: formatZodError(parsed.error) }

  const challenge = await consumeChallenge(deps.ops, deps.config, deps.now, {
    cookieHeader: req.headers.cookie,
    expectedType: 'auth',
  })
  if (challenge instanceof Error) return toAuthResult(challenge)

  const response = parsed.data.authenticationResponse as unknown as AuthenticationResponseJSON
  const credentialId = response.id

  const result = await runExclusive(deviceKey(credentialId), async () => {
    const device = await getDevice(deps.ops, credentialId)
    if (device instanceof Error) return device
    if (device.disabled || device.status !== 'active') return new DeviceDisabledError()

    const verified = await verifyAuthentication(deps.config, {
      response,
      expectedChallenge: challenge.challenge,
      device: {
        credentialId: device.credentialId,
        publicKey: device.publicKey,
        signCount: device.signCount,
        ...(device.transports
          ? { transports: device.transports as AuthenticatorTransportFuture[] }
          : {}),
      },
    })
    if (verified instanceof Error) return verified

    await updateSignCount(deps.ops, credentialId, verified.newSignCount)

    return device
  })
  if (result instanceof Error) return toAuthResult(result)
  const device = result

  const session = await issueSession(deps.ops, deps.config, deps.now, {
    accountId: device.accountId,
    credentialId,
    ...(clientIp(req) ? { ip: clientIp(req) as string } : {}),
    ...(req.headers['user-agent'] ? { ua: req.headers['user-agent'] } : {}),
  })

  return {
    status: 200,
    body: { accountId: device.accountId, credentialId },
    headers: {
      'Set-Cookie': sessionCookieFor(
        deps.config,
        session.sessionId,
        deps.config.sessionTtlSlidingMs,
      ),
    },
  }
}

export async function getSession(deps: AuthDeps, req: IncomingMessage): Promise<AuthResult> {
  const sessionId = readSessionId(deps.config, req)
  if (!sessionId) return { status: 401, body: { code: 'session_missing' } }

  const session = await verifySession(deps.ops, deps.config, deps.now, sessionId)
  if (session instanceof Error) return toAuthResult(session)

  const { record, refreshed } = session
  if (!refreshed) return { status: 200, body: { accountId: record.accountId } }

  return {
    status: 200,
    body: { accountId: record.accountId },
    headers: {
      'Set-Cookie': sessionCookieFor(
        deps.config,
        sessionId,
        Math.max(record.expiresAt - deps.now(), 0),
      ),
    },
  }
}

export async function postLogout(deps: AuthDeps, req: IncomingMessage): Promise<AuthResult> {
  const sessionId = readSessionId(deps.config, req)
  if (sessionId) await revokeSession(deps.ops, sessionId)

  return {
    status: 204,
    headers: { 'Set-Cookie': clearedSessionCookie(deps.config) },
  }
}
