import 'fake-indexeddb/auto'
import { context } from '@reatom/core'
import { makeFakeOpenEventStream } from '@shared/http/test/fake-event-stream'
import { makeScriptedHttp } from '@shared/http/test/scripted-http'
import { afterEach, describe, expect, it } from 'vitest'

import { makeHostRuntime } from './host-runtime'
import { makeStaticWidgetIdentity } from './identity'
import { bindModule, type ModuleContext } from './modules/define-module'
import { db } from './storage/client/db'
import { resetClientStorage } from './storage/test/fakes'

afterEach(async () => {
  context.reset()
  await resetClientStorage()
})

const viewer = (accountId: string) =>
  makeStaticWidgetIdentity({
    members: [{ accountId, name: accountId }],
    viewerAccountId: accountId,
  })

describe('makeHostRuntime account storage', () => {
  it('builds a runtime and its widget storage without sending any request', () => {
    const { http, calls } = makeScriptedHttp({})
    const runtime = makeHostRuntime({ http })
    runtime.makeWidgetStorage({ instanceId: 'inst-1', typeId: 'clock' })
    runtime.makeBranchStorage({ owner: 'module', id: 'ofelia', scope: 'account' })
    expect(calls).toEqual([])
  })

  it('returns account_unavailable from direct account operations on a host with no viewer', async () => {
    const { http, calls } = makeScriptedHttp({})
    const runtime = makeHostRuntime({ http, identity: makeStaticWidgetIdentity() })
    const storage = runtime.makeWidgetStorage({ instanceId: 'inst-1', typeId: 'clock' })

    expect(await storage.account.client.get('k')).toMatchObject({ reason: 'account_unavailable' })
    expect(await storage.account.client.set('k', 1)).toMatchObject({
      reason: 'account_unavailable',
    })
    expect(await storage.account.server.get('k')).toMatchObject({ reason: 'account_unavailable' })
    expect(calls).toEqual([])
  })

  it('returns account_unavailable without hanging while a session-less identity answers 401', async () => {
    const { http } = makeScriptedHttp({ '/api/auth/accounts': [{ status: 401 }] })
    const runtime = makeHostRuntime({ http })
    const storage = runtime.makeWidgetStorage({ instanceId: 'inst-1', typeId: 'clock' })

    expect(await storage.account.client.get('k')).toMatchObject({ reason: 'account_unavailable' })
  })

  it("stores the viewer's account rows under the account namespace and keeps accounts apart", async () => {
    const { http } = makeScriptedHttp({})
    const a1 = makeHostRuntime({ http, identity: viewer('a1') }).makeWidgetStorage({
      instanceId: 'inst-1',
      typeId: 'clock',
    })
    const a2 = makeHostRuntime({ http, identity: viewer('a2') }).makeWidgetStorage({
      instanceId: 'inst-1',
      typeId: 'clock',
    })

    expect(await a1.account.client.set('k', 1)).toBeUndefined()
    expect((await db.entries.get('w:a:clock:a1:k'))?.value).toBe(1)
    expect(await a2.account.client.get('k')).toBeNull()
    expect(await a2.account.client.keys()).toEqual([])
    expect(await a1.account.client.get('k')).toBe(1)
  })

  it('routes account server storage to the scoped branch path', async () => {
    const url = '/api/storage/scoped/widget/clock/account/k'
    const { http, calls } = makeScriptedHttp({ [url]: [{ status: 200, body: { value: 3 } }] })
    const storage = makeHostRuntime({ http, identity: viewer('a1') }).makeWidgetStorage({
      instanceId: 'inst-1',
      typeId: 'clock',
    })

    expect(await storage.account.server.get('k')).toBe(3)
    expect(calls.map((c) => c.url)).toEqual([url])
  })
})

describe('makeHostRuntime', () => {
  it('scopes widget storage to instance and type namespaces over the injected port', async () => {
    const instanceKey = `/api/storage/${encodeURIComponent('w:i:inst-1:k')}`
    const typeKey = `/api/storage/${encodeURIComponent('w:t:clock:k')}`
    const { http, calls } = makeScriptedHttp({
      [instanceKey]: [{ status: 200, body: { value: 1 } }],
      [typeKey]: [{ status: 200, body: { value: 2 } }],
    })
    const runtime = makeHostRuntime({ http })
    const storage = runtime.makeWidgetStorage({ instanceId: 'inst-1', typeId: 'clock' })

    expect(await storage.instance.server.get('k')).toBe(1)
    expect(await storage.shared.server.get('k')).toBe(2)
    expect(calls.map((c) => c.url)).toEqual([instanceKey, typeKey])
  })

  it('makeScopedStorage uses the raw scope', async () => {
    const rootKey = `/api/storage/${encodeURIComponent('root:k')}`
    const { http } = makeScriptedHttp({ [rootKey]: [{ status: 404 }] })
    const runtime = makeHostRuntime({ http })
    expect(await runtime.makeScopedStorage('root').server.get('k')).toBeNull()
  })

  it('makeWidgetApi posts through the same injected port', async () => {
    const { http, calls } = makeScriptedHttp({
      '/api/widgets/t/echo': [{ status: 200, body: { data: 7 } }],
    })
    const runtime = makeHostRuntime({ http })
    const api = runtime.makeWidgetApi<{ echo: { payload: unknown; result: number } }>({
      instanceId: 'i',
      typeId: 't',
    })
    expect(await api.invoke('echo', {})).toBe(7)
    expect(calls[0]?.method).toBe('POST')
  })

  it('gives a module a context holding exactly its declared storage scopes', async () => {
    const { http, calls } = makeScriptedHttp({})
    const runtime = makeHostRuntime({ http, identity: makeStaticWidgetIdentity() })
    const ref = bindModule('notes', {
      scopes: ['shared'],
      actions: {},
      loadModel: async () => (context: ModuleContext<{}, 'shared'>) => context,
    })

    const context = await runtime.makeWidgetModules(['notes']).get(ref)
    if (context instanceof Error) throw context
    expect(context.moduleId).toBe('notes')
    expect(Object.keys(context.storage)).toEqual(['shared'])
    expect(context.storage).not.toHaveProperty('account')
    expect(context.identity).toBe(runtime.identity)
    expect(calls).toEqual([])
  })

  it('shares one file slot per branch and key between modules and widget storage', async () => {
    const url = '/api/files/scoped/module/notes/shared/cover'
    const { http, calls } = makeScriptedHttp({ [url]: [{ status: 204 }] })
    const runtime = makeHostRuntime({ http, identity: makeStaticWidgetIdentity() })
    const ref = bindModule('notes', {
      scopes: ['shared'],
      actions: {},
      loadModel: async () => (context: ModuleContext<{}, 'shared'>) => context,
    })

    const context = await runtime.makeWidgetModules(['notes']).get(ref)
    if (context instanceof Error) throw context
    const slot = context.files('shared', 'cover')
    expect(context.files('shared', 'cover')).toBe(slot)
    expect(
      runtime.makeBranchStorage({ owner: 'module', id: 'notes', scope: 'shared' }).files('cover'),
    ).toBe(slot)
    expect(calls).toEqual([])

    expect(await slot.remove()).toBeUndefined()
    expect(calls[0]).toMatchObject({ method: 'DELETE', url })
  })

  it("gates a widget's account file slot on the viewer", async () => {
    const { http, calls } = makeScriptedHttp({})
    const runtime = makeHostRuntime({ http, identity: makeStaticWidgetIdentity() })
    const storage = runtime.makeWidgetStorage({ instanceId: 'inst-1', typeId: 'clock' })

    expect(await storage.account.files('photo').remove()).toMatchObject({
      reason: 'account_unavailable',
    })
    expect(calls).toEqual([])
  })

  it('opens the SSE stream lazily through the injected openEventStream', () => {
    const fake = makeFakeOpenEventStream()
    const { http } = makeScriptedHttp({
      [`/api/storage/${encodeURIComponent('root:k')}`]: [{ status: 404 }],
    })
    const runtime = makeHostRuntime({ http, openEventStream: fake.open })
    expect(fake.streams.length).toBe(0)

    const storage = runtime.makeScopedStorage('root')
    const unsubscribe = storage.server.subscribe('k', () => {})
    expect(fake.streams.length).toBe(1)
    unsubscribe()
  })
})
