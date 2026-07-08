import { describe, expect, it } from 'vitest'

import { InviteNotFoundError } from '../src/auth/errors'
import { createInvite, lookupInvite } from '../src/auth/invites'
import { createMemoryOps, createMemoryPubSub } from '../src/test/memory-ops'
import { runRevokeInvite } from './revoke-invite'

const now = () => 1_700_000_000_000

describe('runRevokeInvite', () => {
  it('kills a live invite by id', async () => {
    const ops = createMemoryOps(createMemoryPubSub())
    const { record, token } = await createInvite(ops, now, { ttlMs: 60_000 })

    expect(await runRevokeInvite(ops, record.id)).toBe(true)
    expect(await lookupInvite(ops, now, token)).toBeInstanceOf(InviteNotFoundError)
  })
})
