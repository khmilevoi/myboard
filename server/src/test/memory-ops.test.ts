import { describe, expect, it, vi } from 'vitest'

import { createMemoryOps, createMemoryPubSub } from './memory-ops'

describe('createMemoryPubSub', () => {
  it('delivers published messages to subscribers of the same channel', () => {
    const pubsub = createMemoryPubSub()
    const received: string[] = []
    pubsub.subscribe('storage:events', (m) => received.push(m))
    pubsub.publish('storage:events', 'hello')
    expect(received).toEqual(['hello'])
  })

  it('stops delivering after unsubscribe', () => {
    const pubsub = createMemoryPubSub()
    const fn = vi.fn()
    const off = pubsub.subscribe('c', fn)
    off()
    pubsub.publish('c', 'x')
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('createMemoryOps', () => {
  it('round-trips set/get and removes on del', async () => {
    const ops = createMemoryOps(createMemoryPubSub())
    await ops.set('k', '1')
    expect(await ops.get('k')).toBe('1')
    await ops.del('k')
    expect(await ops.get('k')).toBeNull()
  })

  it('scanKeys returns keys by prefix and clear empties the store', async () => {
    const ops = createMemoryOps(createMemoryPubSub())
    await ops.set('w:t:a:1', 'x')
    await ops.set('w:t:b:1', 'y')
    expect(await ops.scanKeys('w:t:a:')).toEqual(['w:t:a:1'])
    ops.clear()
    expect(await ops.scanKeys('w:t:')).toEqual([])
  })

  it('ops.publish fans out through the shared pub/sub', async () => {
    const pubsub = createMemoryPubSub()
    const ops = createMemoryOps(pubsub)
    const received: string[] = []
    pubsub.subscribe('storage:events', (m) => received.push(m))
    await ops.publish('storage:events', '{"key":"k","value":1}')
    expect(received).toEqual(['{"key":"k","value":1}'])
  })
})
