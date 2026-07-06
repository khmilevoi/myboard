import type { IncomingMessage } from 'node:http'

import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from '@simplewebauthn/server'

import { readJsonBody } from '../http/body'
import { runExclusive } from '../storage/key-lock'
import { formatZodError } from '../storage/schemas'
import { formatAddCode, mintAddToken } from './add-tokens'
import { consumeChallenge, saveChallenge } from './challenge-store'
import { getDevice, listDevices, updateSignCount } from './devices'
import { DeviceDisabledError, NotAuthorizedError } from './errors'
import { clearedChallengeCookie, toAuthResult } from './handlers'
import type { AuthDeps, AuthResult } from './handlers'
import { deviceKey } from './records'
import { AddTokenVerifyBodySchema } from './schemas'
import { isAuthResult, requireSession } from './session-guard'
import { buildAuthenticationOptions, verifyAuthentication } from './webauthn'

const PUBLIC_APP_URL = () => process.env.PUBLIC_APP_URL ?? 'http://localhost:5173'
const ADD_TOKEN_TTL_MS = 5 * 60_000

async function readBody(req: IncomingMessage): Promise<unknown> {
  return readJsonBody(req).catch(() => undefined)
}

export async function postAddTokenOptions(
  deps: AuthDeps,
  req: IncomingMessage,
): Promise<AuthResult> {
  const session = await requireSession(deps, req)
  if (isAuthResult(session)) return session

  const devices = await listDevices(deps.ops, session.accountId)
  const allowCredentials = devices
    .filter((device) => device.status === 'active' && !device.disabled)
    .map((device) => ({
      id: device.credentialId,
      ...(device.transports
        ? { transports: device.transports as AuthenticatorTransportFuture[] }
        : {}),
    }))

  const options = await buildAuthenticationOptions(deps.config, { allowCredentials })

  const { cookie } = await saveChallenge(deps.ops, deps.config, deps.now, {
    type: 'auth',
    challenge: options.challenge,
    accountId: session.accountId,
  })

  return { status: 200, body: { options }, headers: { 'Set-Cookie': cookie } }
}

export async function postAddToken(deps: AuthDeps, req: IncomingMessage): Promise<AuthResult> {
  const session = await requireSession(deps, req)
  if (isAuthResult(session)) return session

  const parsed = AddTokenVerifyBodySchema.safeParse(await readBody(req))
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
    if (device.accountId !== session.accountId) return new NotAuthorizedError()
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

  const { code } = await mintAddToken(deps.ops, deps.now, {
    accountId: session.accountId,
    ttlMs: ADD_TOKEN_TTL_MS,
  })

  return {
    status: 200,
    body: {
      code,
      formatted: formatAddCode(code),
      url: `${PUBLIC_APP_URL()}/add-device?token=${code}`,
      expiresAt: deps.now() + ADD_TOKEN_TTL_MS,
    },
    headers: { 'Set-Cookie': clearedChallengeCookie(deps.config) },
  }
}
