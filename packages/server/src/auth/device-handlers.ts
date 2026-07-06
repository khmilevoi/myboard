import type { IncomingMessage } from 'node:http'

import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
} from '@simplewebauthn/server'

import { readJsonBody } from '../http/body'
import { runExclusive } from '../storage/key-lock'
import { formatZodError } from '../storage/schemas'
import { addDeviceToAccount, getAccount } from './accounts'
import {
  consumeAddToken,
  formatAddCode,
  lookupAddToken,
  mintAddToken,
  recordAddTokenFailure,
} from './add-tokens'
import { consumeChallenge, saveChallenge } from './challenge-store'
import { publishAuthDeviceEvent } from './device-events'
import {
  getDevice,
  listDevices,
  revokeDevice,
  setDeviceStatus,
  storeDevice,
  updateSignCount,
} from './devices'
import {
  AddTokenInvalidError,
  DeviceDisabledError,
  DeviceLimitError,
  DeviceNotFoundError,
  LastActiveDeviceError,
  NotAuthorizedError,
} from './errors'
import { clearedChallengeCookie, deviceLabelFromUa, toAuthResult } from './handlers'
import type { AuthDeps, AuthResult } from './handlers'
import { issuePendingTicket, readPendingTicket } from './pending-tickets'
import { type DeviceRecord, deviceKey } from './records'
import {
  AddDeviceRegisterOptionsBodySchema,
  AddDeviceRegisterVerifyBodySchema,
  AddTokenVerifyBodySchema,
} from './schemas'
import { isAuthResult, requireSession } from './session-guard'
import { randomId } from './tokens'
import {
  buildAuthenticationOptions,
  buildRegistrationOptions,
  verifyAuthentication,
  verifyRegistration,
} from './webauthn'

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

export async function postDeviceRegisterOptions(
  deps: AuthDeps,
  req: IncomingMessage,
): Promise<AuthResult> {
  const parsed = AddDeviceRegisterOptionsBodySchema.safeParse(await readBody(req))
  if (!parsed.success) return { status: 422, body: formatZodError(parsed.error) }
  const { token } = parsed.data

  const addToken = await lookupAddToken(deps.ops, deps.now, token)
  if (addToken instanceof Error) return toAuthResult(addToken)

  const account = await getAccount(deps.ops, addToken.accountId)
  if (account instanceof Error) return toAuthResult(account)

  const devices = await listDevices(deps.ops, addToken.accountId)
  const excludeCredentials = devices.map((device) => ({ id: device.credentialId }))

  const options = await buildRegistrationOptions(deps.config, {
    userId: randomId(16),
    userName: account.name,
    userDisplayName: account.name,
    excludeCredentials,
  })

  const { cookie } = await saveChallenge(deps.ops, deps.config, deps.now, {
    type: 'add-device',
    challenge: options.challenge,
    accountId: addToken.accountId,
  })

  return { status: 200, body: { options }, headers: { 'Set-Cookie': cookie } }
}

export async function postDeviceRegisterVerify(
  deps: AuthDeps,
  req: IncomingMessage,
): Promise<AuthResult> {
  const parsed = AddDeviceRegisterVerifyBodySchema.safeParse(await readBody(req))
  if (!parsed.success) return { status: 422, body: formatZodError(parsed.error) }
  const { token, attestationResponse } = parsed.data

  const fail = async (err: Error): Promise<AuthResult> => {
    await recordAddTokenFailure(deps.ops, deps.now, token)
    return toAuthResult(err)
  }

  const challenge = await consumeChallenge(deps.ops, deps.config, deps.now, {
    cookieHeader: req.headers.cookie,
    expectedType: 'add-device',
  })
  if (challenge instanceof Error) return fail(challenge)

  const verified = await verifyRegistration(deps.config, {
    response: attestationResponse as unknown as RegistrationResponseJSON,
    expectedChallenge: challenge.challenge,
  })
  if (verified instanceof Error) return fail(verified)

  // The challenge's accountId was bound at the options step from a live
  // add-token lookup; re-check it against a fresh live lookup of the token
  // submitted here so a challenge can't be replayed with a different (or
  // since-reassigned) add-token to attach a device to the wrong account.
  const addToken = await lookupAddToken(deps.ops, deps.now, token)
  if (addToken instanceof Error) return fail(addToken)
  if (addToken.accountId !== challenge.accountId) return fail(new AddTokenInvalidError())

  // Runs before storeDevice so a device-limit failure (defensive; unreachable
  // while countsAgainstLimit is false here) leaves no orphaned device record
  // behind, mirroring postRegisterVerify.
  const addResult = await addDeviceToAccount(deps.ops, addToken.accountId, verified.credentialId, {
    countsAgainstLimit: false,
  })
  if (addResult instanceof Error) return fail(addResult)

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
    accountId: addToken.accountId,
    status: 'pending',
    addedVia: 'add-token',
  })

  const consumed = await consumeAddToken(deps.ops, deps.now, token)
  if (consumed instanceof Error) return fail(consumed)

  const { cookie } = await issuePendingTicket(deps.ops, deps.config, deps.now, {
    credentialId: verified.credentialId,
    accountId: addToken.accountId,
  })

  await publishAuthDeviceEvent(deps.ops, addToken.accountId, {
    type: 'device-pending',
    credentialId: verified.credentialId,
    label,
  })

  return {
    status: 200,
    body: { credentialId: verified.credentialId },
    headers: {
      'Set-Cookie': [cookie, clearedChallengeCookie(deps.config)],
    },
  }
}

export type DeviceDto = {
  credentialId: string
  label: string
  status: 'active' | 'pending'
  addedVia: 'invite' | 'add-token'
  createdAt: number
  lastSeenAt: number
}

function toDeviceDto(device: DeviceRecord): DeviceDto {
  // Deliberately excludes publicKey (and inviteId/disabled/transports): the
  // device-management UI must never see credential public keys.
  return {
    credentialId: device.credentialId,
    label: device.label,
    status: device.status,
    addedVia: device.addedVia,
    createdAt: device.createdAt,
    lastSeenAt: device.lastSeenAt,
  }
}

async function assertOwnedDevice(
  deps: AuthDeps,
  accountId: string,
  credentialId: string,
): Promise<DeviceRecord | AuthResult> {
  const device = await getDevice(deps.ops, credentialId)
  if (device instanceof Error) return toAuthResult(device)
  if (device.accountId !== accountId) return toAuthResult(new NotAuthorizedError())
  return device
}

export async function getAccountInfo(deps: AuthDeps, req: IncomingMessage): Promise<AuthResult> {
  const session = await requireSession(deps, req)
  if (isAuthResult(session)) return session

  const account = await getAccount(deps.ops, session.accountId)
  if (account instanceof Error) return toAuthResult(account)

  return {
    status: 200,
    body: { id: account.id, name: account.name, deviceLimit: account.deviceLimit },
  }
}

export async function getDevices(deps: AuthDeps, req: IncomingMessage): Promise<AuthResult> {
  const session = await requireSession(deps, req)
  if (isAuthResult(session)) return session

  const devices = await listDevices(deps.ops, session.accountId)

  return {
    status: 200,
    body: { devices: devices.map(toDeviceDto), thisCredentialId: session.credentialId },
  }
}

export async function postApproveDevice(
  deps: AuthDeps,
  req: IncomingMessage,
  params: { credentialId: string },
): Promise<AuthResult> {
  const session = await requireSession(deps, req)
  if (isAuthResult(session)) return session

  const device = await assertOwnedDevice(deps, session.accountId, params.credentialId)
  if (isAuthResult(device)) return device
  // Approving only makes sense for a device that is still awaiting owner
  // action; treat any other state the same as "not authorized to do this".
  if (device.status !== 'pending') return toAuthResult(new NotAuthorizedError())

  const account = await getAccount(deps.ops, session.accountId)
  if (account instanceof Error) return toAuthResult(account)

  const devices = await listDevices(deps.ops, session.accountId)
  const activeCount = devices.filter((d) => d.status === 'active').length
  if (activeCount + 1 > account.deviceLimit) return toAuthResult(new DeviceLimitError())

  await setDeviceStatus(deps.ops, device.credentialId, 'active')

  await publishAuthDeviceEvent(deps.ops, session.accountId, {
    type: 'device-approved',
    credentialId: device.credentialId,
    label: device.label,
  })

  return { status: 200, body: { ok: true } }
}

export async function postDenyDevice(
  deps: AuthDeps,
  req: IncomingMessage,
  params: { credentialId: string },
): Promise<AuthResult> {
  const session = await requireSession(deps, req)
  if (isAuthResult(session)) return session

  const device = await assertOwnedDevice(deps, session.accountId, params.credentialId)
  if (isAuthResult(device)) return device
  if (device.status !== 'pending') return toAuthResult(new NotAuthorizedError())

  await revokeDevice(deps.ops, device.credentialId)

  await publishAuthDeviceEvent(deps.ops, session.accountId, {
    type: 'device-denied',
    credentialId: device.credentialId,
    label: device.label,
  })

  return { status: 204 }
}

export async function postRevokeDevice(
  deps: AuthDeps,
  req: IncomingMessage,
  params: { credentialId: string },
): Promise<AuthResult> {
  const session = await requireSession(deps, req)
  if (isAuthResult(session)) return session

  const device = await assertOwnedDevice(deps, session.accountId, params.credentialId)
  if (isAuthResult(device)) return device
  if (device.status !== 'active') return toAuthResult(new NotAuthorizedError())

  const devices = await listDevices(deps.ops, session.accountId)
  const activeCount = devices.filter((d) => d.status === 'active').length
  if (activeCount <= 1) return toAuthResult(new LastActiveDeviceError())

  await revokeDevice(deps.ops, device.credentialId)

  await publishAuthDeviceEvent(deps.ops, session.accountId, {
    type: 'device-revoked',
    credentialId: device.credentialId,
    label: device.label,
  })

  return { status: 204 }
}

export async function getPendingStatus(deps: AuthDeps, req: IncomingMessage): Promise<AuthResult> {
  const ticket = await readPendingTicket(deps.ops, deps.config, deps.now, req.headers.cookie)
  if (ticket instanceof Error) return toAuthResult(ticket)

  const device = await getDevice(deps.ops, ticket.credentialId)
  // A missing device record means the owner denied the join request: denying
  // deletes the pending device (see postDenyDevice / revokeDevice).
  if (device instanceof DeviceNotFoundError) return { status: 200, body: { status: 'denied' } }
  if (device instanceof Error) return toAuthResult(device)

  return { status: 200, body: { status: device.status === 'active' ? 'approved' : 'pending' } }
}
