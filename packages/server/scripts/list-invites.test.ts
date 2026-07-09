import { describe, expect, it } from 'vitest'

import { consumeInvite, createInvite, recordInviteFailure } from '../src/auth/invites'
import { createMemoryOps, createMemoryPubSub } from '../src/test/memory-ops'
import { runListInvites } from './list-invites'

const now = () => 1_700_000_000_000

describe('runListInvites', () => {
  it('returns [] on an empty store', async () => {
    const ops = createMemoryOps(createMemoryPubSub())
    expect(await runListInvites(ops, now)).toEqual([])
  })

  it('lists a live invite with label and createdBy', async () => {
    const ops = createMemoryOps(createMemoryPubSub())
    const { record } = await createInvite(ops, now, {
      ttlMs: 60_000,
      label: "Grandma's iPad",
      createdBy: 'admin',
    })

    const listing = await runListInvites(ops, now)
    expect(listing).toEqual([
      {
        id: record.id,
        label: "Grandma's iPad",
        createdBy: 'admin',
        createdAt: new Date(record.createdAt).toISOString(),
        expiresAt: new Date(record.expiresAt).toISOString(),
        uses: 0,
        maxUses: 1,
        status: 'active',
      },
    ])
  })

  it('omits label and createdBy when absent', async () => {
    const ops = createMemoryOps(createMemoryPubSub())
    await createInvite(ops, now, { ttlMs: 60_000 })

    const listing = await runListInvites(ops, now)
    expect(listing[0]).not.toHaveProperty('label')
    expect(listing[0]).not.toHaveProperty('createdBy')
  })

  it('reports consumed and locked statuses', async () => {
    const ops = createMemoryOps(createMemoryPubSub())
    const { token: consumedToken } = await createInvite(ops, now, { ttlMs: 60_000, maxUses: 1 })
    await consumeInvite(ops, now, consumedToken)

    const { token: lockedToken } = await createInvite(ops, now, { ttlMs: 60_000 })
    for (let i = 0; i < 10; i++) {
      await recordInviteFailure(ops, now, lockedToken)
    }

    const listing = await runListInvites(ops, now)
    const statuses = listing.map((invite) => invite.status).sort()
    expect(statuses).toEqual(['consumed', 'locked'])
  })

  it('sorts active invites before consumed and locked ones', async () => {
    const ops = createMemoryOps(createMemoryPubSub())
    const { token: consumedToken } = await createInvite(ops, now, {
      ttlMs: 60_000,
      maxUses: 1,
      label: 'consumed-one',
    })
    await consumeInvite(ops, now, consumedToken)
    await createInvite(ops, now, { ttlMs: 60_000, label: 'active-one' })

    const listing = await runListInvites(ops, now)
    expect(listing.map((invite) => invite.label)).toEqual(['active-one', 'consumed-one'])
  })
})
