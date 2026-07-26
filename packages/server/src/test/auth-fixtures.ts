import type { IncomingMessage } from 'node:http'
import { Readable } from 'node:stream'

import { addDeviceToAccount, createAccount } from '../auth/accounts'
import type { AuthConfig } from '../auth/config'
import { storeDevice } from '../auth/devices'
import { issueSession } from '../auth/sessions'
import { createMemoryOps, createMemoryPubSub } from './memory-ops'

const MINUTE = 60_000

export function makeOps() {
  return createMemoryOps(createMemoryPubSub())
}

export type Ops = ReturnType<typeof makeOps>

export function makeClock(start = 0) {
  let time = start
  return {
    now: () => time,
    set: (value: number) => {
      time = value
    },
  }
}

export function makeConfig(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
    rpID: 'localhost',
    rpName: 'Board',
    expectedOrigin: 'http://localhost',
    sessionCookieName: 'mb_session',
    challengeCookieName: 'mb_chal',
    pendingCookieName: 'mb_pending',
    sessionTtlSlidingMs: 30 * 24 * 60 * MINUTE,
    sessionTtlAbsoluteMs: 90 * 24 * 60 * MINUTE,
    secureCookies: false,
    trustCfConnectingIp: false,
    ...overrides,
  }
}

export function fakeReq(body: unknown, headers: Record<string, string> = {}): IncomingMessage {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const req = Readable.from(chunks) as unknown as IncomingMessage
  req.headers = headers as IncomingMessage['headers']
  req.socket = { remoteAddress: '127.0.0.1' } as IncomingMessage['socket']
  return req
}

export async function seedAccountWithDevice(
  ops: Ops,
  now: () => number,
  credentialId: string,
  overrides: { name?: string; status?: 'active' | 'pending'; disabled?: boolean } = {},
) {
  const account = await createAccount(ops, now, {
    name: overrides.name ?? 'Acc',
    inviteId: 'inv-1',
  })
  await storeDevice(ops, {
    credentialId,
    publicKey: 'pk',
    signCount: 5,
    label: 'Board device',
    createdAt: 0,
    lastSeenAt: 0,
    disabled: overrides.disabled ?? false,
    accountId: account.id,
    status: overrides.status ?? 'active',
    addedVia: 'invite',
  })
  await addDeviceToAccount(ops, account.id, credentialId, { countsAgainstLimit: false })
  return account
}

/** A live session plus a request already carrying its cookie. */
export async function seedSessionCookie(
  ops: Ops,
  config: AuthConfig,
  now: () => number,
  overrides: { name?: string } = {},
) {
  const account = await seedAccountWithDevice(ops, now, 'cred-active', overrides)
  const session = await issueSession(ops, config, now, {
    accountId: account.id,
    credentialId: 'cred-active',
  })
  return {
    account,
    req: fakeReq(undefined, { cookie: `${config.sessionCookieName}=${session.sessionId}` }),
  }
}
