import { makeScriptedHttp } from '@shared/http/test/scripted-http'
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'

import { makeHostRuntime } from '../host-runtime'
import { db } from './client/db'
import { instanceNamespace, typeNamespace, toFullKey } from './scope'

const { makeWidgetStorage } = makeHostRuntime({ http: makeScriptedHttp({}).http })

beforeEach(async () => {
  await db.entries.clear()
})

describe('createWidgetStorage', () => {
  it('isolates instance client storage from shared client storage', async () => {
    const storage = makeWidgetStorage({ instanceId: 'inst-1', typeId: 'clock' })
    await storage.instance.client.set('draft', 'per-instance')
    await storage.shared.client.set('draft', 'per-type')

    expect(await storage.instance.client.get('draft')).toBe('per-instance')
    expect(await storage.shared.client.get('draft')).toBe('per-type')
  })

  it('isolates one instance from another', async () => {
    const a = makeWidgetStorage({ instanceId: 'inst-a', typeId: 'clock' })
    const b = makeWidgetStorage({ instanceId: 'inst-b', typeId: 'clock' })
    await a.instance.client.set('draft', 'a')
    await b.instance.client.set('draft', 'b')

    expect(await a.instance.client.get('draft')).toBe('a')
    expect(await b.instance.client.get('draft')).toBe('b')
  })

  it('exposes server adapters for both scopes', () => {
    const storage = makeWidgetStorage({ instanceId: 'inst-1', typeId: 'clock' })
    expect(typeof storage.instance.server.get).toBe('function')
    expect(typeof storage.shared.server.get).toBe('function')
  })

  it('stores instance and shared client entries under single-colon keys matching the server helper format', async () => {
    const storage = makeWidgetStorage({ instanceId: 'inst-1', typeId: 'clock' })
    await storage.instance.client.set('draft', 'per-instance')
    await storage.shared.client.set('draft', 'per-type')

    const expectedInstanceKey = toFullKey(instanceNamespace('inst-1'), 'draft')
    const expectedSharedKey = toFullKey(typeNamespace('clock'), 'draft')

    expect(expectedInstanceKey).toBe('w:i:inst-1:draft')
    expect(expectedSharedKey).toBe('w:t:clock:draft')

    expect(await db.entries.get(expectedInstanceKey)).toBeDefined()
    expect(await db.entries.get(expectedSharedKey)).toBeDefined()
  })
})
