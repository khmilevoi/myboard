import { describe, expect, it, vi } from 'vitest'

import { createMemoryOps, createMemoryPubSub } from '../test/memory-ops'
import { InviteConsumedError, InviteExpiredError, InviteLockedError } from './errors'
import {
  consumeInvite,
  createInvite,
  lookupInvite,
  recordInviteFailure,
  releaseInvite,
} from './invites'

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

describe('createInvite', () => {
  it('creates an invite record with default maxUses and zero counters', async () => {
    const ops = makeOps()
    const clock = makeClock(1_000)

    const result = await createInvite(ops, clock.now, { ttlMs: 60_000 })

    expect(result.record).toEqual({
      id: expect.any(String),
      createdAt: 1_000,
      expiresAt: 61_000,
      maxUses: 1,
      uses: 0,
      failedAttempts: 0,
    })
    expect(typeof result.token).toBe('string')
    expect(result.token.length).toBeGreaterThan(0)
  })

  it('honors maxUses, label, and createdBy overrides', async () => {
    const ops = makeOps()
    const clock = makeClock(1_000)

    const result = await createInvite(ops, clock.now, {
      ttlMs: 60_000,
      maxUses: 3,
      label: 'front door',
      createdBy: 'admin',
    })

    expect(result.record.maxUses).toBe(3)
    expect(result.record.label).toBe('front door')
    expect(result.record.createdBy).toBe('admin')
  })
})

describe('lookupInvite', () => {
  it('returns the live record without consuming it', async () => {
    const ops = makeOps()
    const clock = makeClock(1_000)
    const { token, record } = await createInvite(ops, clock.now, { ttlMs: 60_000 })

    const result = await lookupInvite(ops, clock.now, token)

    expect(result).toEqual(record)
    // lookup must not mutate uses
    const second = await lookupInvite(ops, clock.now, token)
    expect(second).toEqual(record)
  })

  it('returns InviteExpiredError once now is past expiresAt', async () => {
    const ops = makeOps()
    const clock = makeClock(1_000)
    const { token } = await createInvite(ops, clock.now, { ttlMs: 1_000 })

    clock.set(2_001)
    const result = await lookupInvite(ops, clock.now, token)

    expect(result).toBeInstanceOf(InviteExpiredError)
  })

  it('returns InviteConsumedError once uses reaches maxUses', async () => {
    const ops = makeOps()
    const clock = makeClock(1_000)
    const { token } = await createInvite(ops, clock.now, { ttlMs: 60_000, maxUses: 1 })

    const consumed = await consumeInvite(ops, clock.now, token)
    expect(consumed).not.toBeInstanceOf(Error)

    const result = await lookupInvite(ops, clock.now, token)
    expect(result).toBeInstanceOf(InviteConsumedError)
  })

  it('returns InviteLockedError after 10 recorded failures', async () => {
    const ops = makeOps()
    const clock = makeClock(1_000)
    const { token } = await createInvite(ops, clock.now, { ttlMs: 60_000 })

    for (let i = 0; i < 10; i++) {
      await recordInviteFailure(ops, clock.now, token)
    }

    const result = await lookupInvite(ops, clock.now, token)
    expect(result).toBeInstanceOf(InviteLockedError)
  })
})

describe('consumeInvite', () => {
  it('increments uses and sets usedAt on first consume', async () => {
    const ops = makeOps()
    const clock = makeClock(1_000)
    const { token } = await createInvite(ops, clock.now, { ttlMs: 60_000 })

    clock.set(2_000)
    const result = await consumeInvite(ops, clock.now, token)

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) throw result
    expect(result.uses).toBe(1)
    expect(result.usedAt).toBe(2_000)
  })

  it('fails the second sequential consume with InviteConsumedError', async () => {
    const ops = makeOps()
    const clock = makeClock(1_000)
    const { token } = await createInvite(ops, clock.now, { ttlMs: 60_000, maxUses: 1 })

    const first = await consumeInvite(ops, clock.now, token)
    expect(first).not.toBeInstanceOf(Error)

    const second = await consumeInvite(ops, clock.now, token)
    expect(second).toBeInstanceOf(InviteConsumedError)
  })

  it('only allows exactly one winner under a concurrent race', async () => {
    const ops = makeOps()
    const clock = makeClock(1_000)
    const { token } = await createInvite(ops, clock.now, { ttlMs: 60_000, maxUses: 1 })

    const [a, b] = await Promise.all([
      consumeInvite(ops, clock.now, token),
      consumeInvite(ops, clock.now, token),
    ])

    const results = [a, b]
    const successes = results.filter((r) => !(r instanceof Error))
    const consumedErrors = results.filter((r) => r instanceof InviteConsumedError)

    expect(successes).toHaveLength(1)
    expect(consumedErrors).toHaveLength(1)
  })

  it('preserves the remaining TTL when re-persisting on consume', async () => {
    const ops = makeOps()
    const clock = makeClock(1_000)
    const { token } = await createInvite(ops, clock.now, { ttlMs: 60_000 })

    const setSpy = vi.spyOn(ops, 'set')
    clock.set(10_000)
    await consumeInvite(ops, clock.now, token)

    const lastCall = setSpy.mock.calls.at(-1)
    expect(lastCall?.[2]).toBe(51_000)
  })
})

describe('recordInviteFailure', () => {
  it('increments failedAttempts', async () => {
    const ops = makeOps()
    const clock = makeClock(1_000)
    const { token } = await createInvite(ops, clock.now, { ttlMs: 60_000 })

    await recordInviteFailure(ops, clock.now, token)
    await recordInviteFailure(ops, clock.now, token)

    const result = await lookupInvite(ops, clock.now, token)
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) throw result
    expect(result.failedAttempts).toBe(2)
  })

  it('preserves the remaining TTL when re-persisting on failure', async () => {
    const ops = makeOps()
    const clock = makeClock(1_000)
    const { token } = await createInvite(ops, clock.now, { ttlMs: 60_000 })

    const setSpy = vi.spyOn(ops, 'set')
    clock.set(10_000)
    await recordInviteFailure(ops, clock.now, token)

    const lastCall = setSpy.mock.calls.at(-1)
    expect(lastCall?.[2]).toBe(51_000)
  })

  it('does not re-persist (SET ... PX 0) an already-expired-but-present invite record', async () => {
    const ops = makeOps()
    const clock = makeClock(1_000)
    const { token } = await createInvite(ops, clock.now, { ttlMs: 1_000 })

    // The fake backing store never purges on its own TTL, so the record stays
    // present past its application-level expiresAt (2_000) -- exercising exactly
    // the clock-skew / TTL-fire-lag race this guard protects against.
    clock.set(5_000)
    const setSpy = vi.spyOn(ops, 'set')

    await expect(recordInviteFailure(ops, clock.now, token)).resolves.toBeUndefined()

    expect(setSpy).not.toHaveBeenCalled()
  })
})

describe('releaseInvite', () => {
  it('decrements uses and clears usedAt, so a spent invite becomes live again', async () => {
    const ops = makeOps()
    const clock = makeClock(1_000)
    const { token } = await createInvite(ops, clock.now, { ttlMs: 60_000 })

    const consumed = await consumeInvite(ops, clock.now, token)
    expect(consumed).not.toBeInstanceOf(Error)
    expect(await lookupInvite(ops, clock.now, token)).toBeInstanceOf(InviteConsumedError)

    await releaseInvite(ops, clock.now, token)

    const result = await lookupInvite(ops, clock.now, token)
    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) throw result
    expect(result.uses).toBe(0)
    expect(result.usedAt).toBeUndefined()
  })

  it('is a no-op for an already-expired invite', async () => {
    const ops = makeOps()
    const clock = makeClock(1_000)
    const { token } = await createInvite(ops, clock.now, { ttlMs: 1_000 })
    await consumeInvite(ops, clock.now, token)

    clock.set(5_000)
    const setSpy = vi.spyOn(ops, 'set')
    await releaseInvite(ops, clock.now, token)

    expect(setSpy).not.toHaveBeenCalled()
  })
})
