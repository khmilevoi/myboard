import { describe, expect, it } from 'vitest'
import { createFakeStorage } from './fakes'

describe('createFakeStorage', () => {
  it('round-trips set and get', async () => {
    const storage = createFakeStorage()
    await storage.set('k', { a: 1 })
    expect(await storage.get('k')).toEqual({ a: 1 })
  })

  it('returns null for a missing key', async () => {
    expect(await createFakeStorage().get('missing')).toBeNull()
  })

  it('append creates then grows an array and honours cap', async () => {
    const storage = createFakeStorage()
    await storage.append('log', 1)
    await storage.append('log', 2)
    await storage.append('log', 3, { cap: 2 })
    expect(await storage.get('log')).toEqual([2, 3])
  })

  it('lists keys filtered by prefix', async () => {
    const storage = createFakeStorage()
    await storage.set('a', 1)
    await storage.set('group:b', 2)
    expect(await storage.keys('group:')).toEqual(['group:b'])
  })

  it('subscribe emits the current value, then each change', async () => {
    const storage = createFakeStorage()
    await storage.set('k', 'first')
    const seen: unknown[] = []
    const off = storage.subscribe('k', (event) => {
      seen.push(event instanceof Error ? 'error' : event.value)
    })
    await storage.append('k', 'x')
    await storage.delete('k')
    off()
    expect(seen[0]).toBe('first')
    expect(seen.at(-1)).toBeNull()
  })
})
