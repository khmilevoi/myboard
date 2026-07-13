import { describe, expect, it } from 'vitest'

import { createMemoryOps, createMemoryPubSub } from '../test/memory-ops'
import type { AuthConfig } from './config'
import { PendingTicketInvalidError } from './errors'
import {
  PENDING_TTL_MS,
  consumePendingTicket,
  issuePendingTicket,
  readPendingTicket,
} from './pending-tickets'

const MINUTE = 60_000

function makeOps() {
  return createMemoryOps(createMemoryPubSub())
}

function makeClock(start = 0) {
  let time = start
  return {
    now: () => time,
    set: (value: number) => {
      time = value
    },
  }
}

function makeConfig(overrides: Partial<AuthConfig> = {}): AuthConfig {
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

function cookieHeaderFor(cookie: string): string {
  // cookie is a Set-Cookie string; extract "name=value" for use as a request Cookie header
  return cookie.split('; ')[0]
}

describe('issuePendingTicket / readPendingTicket', () => {
  it('round-trips: issue then read returns the stored record without consuming it', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()

    const { ticketId, cookie } = await issuePendingTicket(ops, config, clock.now, {
      credentialId: 'cred-1',
      accountId: 'acc-1',
    })

    const first = await readPendingTicket(ops, config, clock.now, cookieHeaderFor(cookie))
    expect(first).not.toBeInstanceOf(Error)
    if (first instanceof Error) throw first
    expect(first).toEqual({
      ticketId,
      credentialId: 'cred-1',
      accountId: 'acc-1',
      expiresAt: PENDING_TTL_MS,
    })

    // reading again (polling) still returns the record — not consumed
    const second = await readPendingTicket(ops, config, clock.now, cookieHeaderFor(cookie))
    expect(second).not.toBeInstanceOf(Error)
    if (second instanceof Error) throw second
    expect(second).toEqual(first)
  })

  it('returns PendingTicketInvalidError once the ticket has expired', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()

    const { cookie } = await issuePendingTicket(ops, config, clock.now, {
      credentialId: 'cred-1',
      accountId: 'acc-1',
    })

    clock.set(PENDING_TTL_MS + 1)
    const result = await readPendingTicket(ops, config, clock.now, cookieHeaderFor(cookie))

    expect(result).toBeInstanceOf(PendingTicketInvalidError)
  })

  it('returns PendingTicketInvalidError when the cookie header is missing', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()

    const result = await readPendingTicket(ops, config, clock.now, undefined)

    expect(result).toBeInstanceOf(PendingTicketInvalidError)
  })
})

describe('consumePendingTicket', () => {
  it('deletes and returns the record; a follow-up read no longer finds it', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()

    const { ticketId, cookie } = await issuePendingTicket(ops, config, clock.now, {
      credentialId: 'cred-1',
      accountId: 'acc-1',
    })
    const header = cookieHeaderFor(cookie)

    const consumed = await consumePendingTicket(ops, config, clock.now, header)
    expect(consumed).not.toBeInstanceOf(Error)
    if (consumed instanceof Error) throw consumed
    expect(consumed).toEqual({
      ticketId,
      credentialId: 'cred-1',
      accountId: 'acc-1',
      expiresAt: PENDING_TTL_MS,
    })

    const afterRead = await readPendingTicket(ops, config, clock.now, header)
    expect(afterRead).toBeInstanceOf(PendingTicketInvalidError)
  })

  it('is single-use: a second consume returns PendingTicketInvalidError', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()

    const { cookie } = await issuePendingTicket(ops, config, clock.now, {
      credentialId: 'cred-1',
      accountId: 'acc-1',
    })
    const header = cookieHeaderFor(cookie)

    const first = await consumePendingTicket(ops, config, clock.now, header)
    expect(first).not.toBeInstanceOf(Error)

    const second = await consumePendingTicket(ops, config, clock.now, header)
    expect(second).toBeInstanceOf(PendingTicketInvalidError)
  })

  it('returns PendingTicketInvalidError once the ticket has expired', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()

    const { cookie } = await issuePendingTicket(ops, config, clock.now, {
      credentialId: 'cred-1',
      accountId: 'acc-1',
    })
    clock.set(PENDING_TTL_MS + 1)

    const result = await consumePendingTicket(ops, config, clock.now, cookieHeaderFor(cookie))
    expect(result).toBeInstanceOf(PendingTicketInvalidError)
  })

  it('returns PendingTicketInvalidError when the cookie header is missing', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()

    const result = await consumePendingTicket(ops, config, clock.now, undefined)
    expect(result).toBeInstanceOf(PendingTicketInvalidError)
  })

  it('single-use under concurrency: two simultaneous consumes yield exactly one record', async () => {
    const ops = makeOps()
    const clock = makeClock(0)
    const config = makeConfig()

    const { cookie } = await issuePendingTicket(ops, config, clock.now, {
      credentialId: 'cred-1',
      accountId: 'acc-1',
    })
    const header = cookieHeaderFor(cookie)

    const [a, b] = await Promise.all([
      consumePendingTicket(ops, config, clock.now, header),
      consumePendingTicket(ops, config, clock.now, header),
    ])

    const records = [a, b].filter((r) => !(r instanceof Error))
    const invalid = [a, b].filter((r) => r instanceof PendingTicketInvalidError)
    expect(records).toHaveLength(1)
    expect(invalid).toHaveLength(1)
  })
})
