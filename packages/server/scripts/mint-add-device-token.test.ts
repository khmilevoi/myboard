import { describe, expect, it } from 'vitest'

import { createAccount } from '../src/auth/accounts'
import { lookupAddToken } from '../src/auth/add-tokens'
import { AccountNotFoundError } from '../src/auth/errors'
import { createMemoryOps, createMemoryPubSub } from '../src/test/memory-ops'
import { runMintAddDeviceToken } from './mint-add-device-token'

const now = () => 1_700_000_000_000

describe('runMintAddDeviceToken', () => {
  it('mints a live add-device code for an existing account', async () => {
    const ops = createMemoryOps(createMemoryPubSub())
    const account = await createAccount(ops, now, { name: 'Dave', inviteId: 'inv' })

    const result = await runMintAddDeviceToken(ops, now, 'https://board.example', {
      accountId: account.id,
      ttlMs: 300_000,
    })
    if (result instanceof Error) throw result

    expect(result.code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/)
    expect(result.url).toBe(
      `https://board.example/add-device?token=${result.code.replace('-', '')}`,
    )

    const record = await lookupAddToken(ops, now, result.code)
    if (record instanceof Error) throw record
    expect(record.accountId).toBe(account.id)
  })

  it('refuses an unknown account', async () => {
    const ops = createMemoryOps(createMemoryPubSub())
    const result = await runMintAddDeviceToken(ops, now, 'https://board.example', {
      accountId: 'missing',
      ttlMs: 300_000,
    })
    expect(result).toBeInstanceOf(AccountNotFoundError)
  })
})
