import { describe, expect, it } from 'vitest'

import { FakeBroadcastChannel, makeFakeChannelHub } from '../test/fakes'

describe('channel registry', () => {
  it('publishChange notifies same-runtime subscribers', () => {
    const { registerLocal, publishChange } = makeFakeChannelHub()
    const seen: unknown[] = []
    registerLocal('w:t:clock:settings', (raw) => seen.push(raw))
    publishChange('w:t:clock:settings', { a: 1 })
    expect(seen).toEqual([{ a: 1 }])
  })

  it('does not notify subscribers of a different key', () => {
    const { registerLocal, publishChange } = makeFakeChannelHub()
    const seen: unknown[] = []
    registerLocal('w:t:clock:other', (raw) => seen.push(raw))
    publishChange('w:t:clock:settings', 1)
    expect(seen).toEqual([])
  })

  it('unsubscribe stops delivery', () => {
    const { registerLocal, publishChange } = makeFakeChannelHub()
    const seen: unknown[] = []
    const off = registerLocal('k', (raw) => seen.push(raw))
    off()
    publishChange('k', 1)
    expect(seen).toEqual([])
  })

  it('delivers messages arriving from another runtime via the channel', () => {
    const { registerLocal } = makeFakeChannelHub()
    const seen: unknown[] = []
    registerLocal('w:t:clock:settings', (raw) => seen.push(raw))
    // simulate another tab/iframe posting on the same channel name
    const other = new FakeBroadcastChannel('myboard-storage')
    other.postMessage({ fullKey: 'w:t:clock:settings', value: 99 })
    expect(seen).toEqual([99])
  })
})
