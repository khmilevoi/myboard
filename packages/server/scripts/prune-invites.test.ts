import { describe, expect, it } from 'vitest'

import { consumeInvite, createInvite } from '../src/auth/invites'
import { createMemoryOps, createMemoryPubSub } from '../src/test/memory-ops'
import { runPruneInvites } from './prune-invites'

const now = () => 1_700_000_000_000

describe('runPruneInvites', () => {
  it('prunes consumed invites and keeps active ones', async () => {
    const ops = createMemoryOps(createMemoryPubSub())
    await createInvite(ops, now, { ttlMs: 60_000, label: 'active' })
    const { token, record } = await createInvite(ops, now, { ttlMs: 60_000, maxUses: 1 })
    await consumeInvite(ops, now, token)

    const result = await runPruneInvites(ops, now)

    expect(result).toEqual({ pruned: [{ id: record.id, status: 'consumed' }], kept: 1 })
  })

  it('dry-run leaves every invite in place', async () => {
    const ops = createMemoryOps(createMemoryPubSub())
    const { token, record } = await createInvite(ops, now, { ttlMs: 60_000, maxUses: 1 })
    await consumeInvite(ops, now, token)

    const result = await runPruneInvites(ops, now, { dryRun: true })

    expect(result).toEqual({ pruned: [{ id: record.id, status: 'consumed' }], kept: 0 })
    const remaining = await ops.scanKeys('invite:')
    expect(remaining).toHaveLength(1)
  })
})
