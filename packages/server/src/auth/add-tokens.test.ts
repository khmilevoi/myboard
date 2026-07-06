import { describe, expect, it } from 'vitest'

import { createMemoryOps, createMemoryPubSub } from '../test/memory-ops'
import {
  consumeAddToken,
  generateAddCode,
  lookupAddToken,
  mintAddToken,
  normalizeAddCode,
  recordAddTokenFailure,
} from './add-tokens'
import { AddTokenInvalidError } from './errors'

const TTL = 5 * 60_000

function makeOps() {
  return createMemoryOps(createMemoryPubSub())
}

describe('add-tokens', () => {
  it('generates an 8-char Crockford code with no ambiguous letters', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateAddCode()
      expect(code).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/)
    }
  })

  it('normalizes dashes/case/spaces and rejects bad input', () => {
    expect(normalizeAddCode('k7qp-3m9x')).toBe('K7QP3M9X')
    expect(normalizeAddCode(' K7QP 3M9X ')).toBe('K7QP3M9X')
    expect(normalizeAddCode('short')).toBeNull()
    expect(normalizeAddCode('K7QP3M9I')).toBeNull() // I is not in the alphabet
  })

  it('mints, looks up, and single-use consumes', async () => {
    const ops = makeOps()
    const now = () => 1000
    const { code, record } = await mintAddToken(ops, now, { accountId: 'acc1', ttlMs: TTL })
    expect(record.accountId).toBe('acc1')
    expect(await lookupAddToken(ops, now, code)).toMatchObject({ accountId: 'acc1' })
    expect(await consumeAddToken(ops, now, code)).toMatchObject({ accountId: 'acc1' })
    expect(await lookupAddToken(ops, now, code)).toBeInstanceOf(AddTokenInvalidError)
  })

  it('expires and locks after too many failures', async () => {
    const ops = makeOps()
    let t = 1000
    const now = () => t
    const { code } = await mintAddToken(ops, now, { accountId: 'acc1', ttlMs: TTL })
    for (let i = 0; i < 10; i++) await recordAddTokenFailure(ops, now, code)
    expect(await lookupAddToken(ops, now, code)).toBeInstanceOf(AddTokenInvalidError)

    const fresh = await mintAddToken(ops, now, { accountId: 'acc1', ttlMs: TTL })
    t = 1000 + TTL + 1
    expect(await lookupAddToken(ops, now, fresh.code)).toBeInstanceOf(AddTokenInvalidError)
  })
})
