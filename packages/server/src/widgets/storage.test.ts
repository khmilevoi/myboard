import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { createMemoryOps, createMemoryPubSub } from '../test/memory-ops'
import { createWidgetServerStorageApi } from './storage'

describe('createWidgetServerStorageApi', () => {
  it('isolates instance and shared namespaces', async () => {
    const pubsub = createMemoryPubSub()
    const ops = createMemoryOps(pubsub)
    const storage = createWidgetServerStorageApi({
      ops,
      typeId: 'clock',
      instanceId: 'placement-1',
      now: () => 123,
      createId: () => 'entry-1',
    })

    expect(await storage.instance.set('settings', { zone: 'UTC' })).toBeUndefined()
    expect(await storage.shared.set('settings', { format: '24h' })).toBeUndefined()
    expect(await ops.get('w:i:placement-1:settings')).toBe('{"zone":"UTC"}')
    expect(await ops.get('w:t:clock:settings')).toBe('{"format":"24h"}')
  })

  it('validates reads and publishes append enrichment', async () => {
    const pubsub = createMemoryPubSub()
    const ops = createMemoryOps(pubsub)
    const messages: string[] = []
    pubsub.subscribe('storage:events', (message) => messages.push(message))
    const storage = createWidgetServerStorageApi({
      ops,
      typeId: 'notes',
      instanceId: 'placement-1',
      now: () => 456,
      createId: () => 'entry-7',
    })

    expect(await storage.shared.append('items', { text: 'hello' })).toBeUndefined()
    // one-release compat shim: pre-release clients require `ip: z.string()`
    // on every append entry, so the server still stamps an empty one.
    const written = await storage.shared.get(
      'items',
      z.array(z.object({ id: z.string(), ts: z.number(), ip: z.string(), text: z.string() })),
    )
    expect(written).toEqual([{ id: 'entry-7', ts: 456, ip: '', text: 'hello' }])
    expect(messages).toEqual([
      JSON.stringify({
        key: 'w:t:notes:items',
        value: [{ id: 'entry-7', ts: 456, ip: '', text: 'hello' }],
      }),
    ])
  })
})
