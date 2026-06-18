import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './client/db'
import { createWidgetStorage } from './widget-storage'

beforeEach(async () => {
  await db.entries.clear()
})

describe('createWidgetStorage', () => {
  it('isolates instance client storage from shared client storage', async () => {
    const storage = createWidgetStorage({ instanceId: 'inst-1', typeId: 'clock' })
    await storage.instance.client.set('draft', 'per-instance')
    await storage.shared.client.set('draft', 'per-type')

    expect(await storage.instance.client.get('draft')).toBe('per-instance')
    expect(await storage.shared.client.get('draft')).toBe('per-type')
  })

  it('isolates one instance from another', async () => {
    const a = createWidgetStorage({ instanceId: 'inst-a', typeId: 'clock' })
    const b = createWidgetStorage({ instanceId: 'inst-b', typeId: 'clock' })
    await a.instance.client.set('draft', 'a')
    await b.instance.client.set('draft', 'b')

    expect(await a.instance.client.get('draft')).toBe('a')
    expect(await b.instance.client.get('draft')).toBe('b')
  })

  it('exposes server adapters for both scopes', () => {
    const storage = createWidgetStorage({ instanceId: 'inst-1', typeId: 'clock' })
    expect(typeof storage.instance.server.get).toBe('function')
    expect(typeof storage.shared.server.get).toBe('function')
  })
})
