import { makeFakeOpenEventStream } from '@shared/http/test/fake-event-stream'
import { makeScriptedHttp } from '@shared/http/test/scripted-http'
import { describe, expect, it } from 'vitest'

import { makeHostRuntime } from './host-runtime'

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
