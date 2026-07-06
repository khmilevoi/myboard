import { describe, expect, it } from 'vitest'

import { createMemoryOps, createMemoryPubSub } from '../test/memory-ops'
import { publishAuthDeviceEvent } from './device-events'

describe('publishAuthDeviceEvent', () => {
  it('publishes the account-scoped device event to the storage events channel', async () => {
    const pubsub = createMemoryPubSub()
    const ops = createMemoryOps(pubsub)
    const received: string[] = []
    pubsub.subscribe('storage:events', (message) => received.push(message))

    await publishAuthDeviceEvent(ops, 'acc1', {
      type: 'device-pending',
      credentialId: 'c1',
      label: 'Chrome',
    })

    expect(received).toHaveLength(1)
    expect(JSON.parse(received[0])).toEqual({
      key: 'auth:account:acc1',
      value: { type: 'device-pending', credentialId: 'c1', label: 'Chrome' },
    })
  })
})
