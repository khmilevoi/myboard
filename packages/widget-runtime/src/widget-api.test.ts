import { makeScriptedHttp } from '@shared/http/test/scripted-http'
// @vitest-environment node
import { describe, expect, expectTypeOf, it } from 'vitest'

import { makeWidgetApi, WidgetApiError } from './widget-api'

type TestEvents = {
  save: {
    payload: { value: string }
    result: { id: string }
  }
}

const URL_SAVE = '/api/widgets/notes%2Fwidget/save'

describe('makeWidgetApi', () => {
  it('binds type and instance identity and returns typed data', async () => {
    const { http, calls } = makeScriptedHttp({
      [URL_SAVE]: [{ status: 200, body: { data: { id: 'entry-1' } } }],
    })
    const api = makeWidgetApi<TestEvents>({
      typeId: 'notes/widget',
      instanceId: 'placement-1',
      http,
    })

    const result = await api.invoke('save', { value: 'hello' })

    expectTypeOf(result).toEqualTypeOf<WidgetApiError | { id: string }>()
    expect(result).toEqual({ id: 'entry-1' })
    expect(calls[0]).toEqual({
      method: 'POST',
      url: URL_SAVE,
      json: { instanceId: 'placement-1', payload: { value: 'hello' } },
    })
  })

  it('returns WidgetApiError for a safe server error envelope', async () => {
    const { http } = makeScriptedHttp({
      '/api/widgets/notes/save': [
        {
          status: 422,
          body: { error: { code: 'payload_invalid', message: 'Widget event payload is invalid' } },
        },
      ],
    })
    const api = makeWidgetApi<TestEvents>({
      typeId: 'notes',
      instanceId: 'placement-1',
      http,
    })

    const result = await api.invoke('save', { value: 'hello' })

    expect(result).toBeInstanceOf(WidgetApiError)
    expect((result as WidgetApiError).message).toContain('payload_invalid')
  })

  it('wraps network rejection as WidgetApiError with a cause', async () => {
    const { http } = makeScriptedHttp({
      '/api/widgets/notes/save': ['network-error'],
    })
    const api = makeWidgetApi<TestEvents>({
      typeId: 'notes',
      instanceId: 'placement-1',
      http,
    })

    const result = await api.invoke('save', { value: 'hello' })

    expect(result).toBeInstanceOf(WidgetApiError)
    expect((result as WidgetApiError).cause).toBeDefined()
  })

  it('exposes the server error code and meta structurally', async () => {
    const { http } = makeScriptedHttp({
      [URL_SAVE]: [
        {
          status: 409,
          body: {
            error: {
              code: 'browser_session_required',
              message: 'The browser session requires attention',
              meta: { sshTarget: 'admin@pi' },
            },
          },
        },
      ],
    })
    const api = makeWidgetApi<TestEvents>({
      typeId: 'notes/widget',
      instanceId: 'placement-1',
      http,
    })

    const result = await api.invoke('save', { value: 'hello' })

    expect(result).toBeInstanceOf(WidgetApiError)
    if (!(result instanceof WidgetApiError)) throw new Error('expected WidgetApiError')
    expect(result.code).toBe('browser_session_required')
    expect(result.meta).toEqual({ sshTarget: 'admin@pi' })
  })

  it('keeps meta undefined when the server sends none', async () => {
    const { http } = makeScriptedHttp({
      [URL_SAVE]: [{ status: 422, body: { error: { code: 'payload_invalid', message: 'nope' } } }],
    })
    const api = makeWidgetApi<TestEvents>({
      typeId: 'notes/widget',
      instanceId: 'placement-1',
      http,
    })

    const result = await api.invoke('save', { value: 'hello' })

    expect(result).toBeInstanceOf(WidgetApiError)
    if (!(result instanceof WidgetApiError)) throw new Error('expected WidgetApiError')
    expect(result.code).toBe('payload_invalid')
    expect(result.meta).toBeUndefined()
  })

  it('synthesizes the network code on transport failure', async () => {
    const { http } = makeScriptedHttp({ [URL_SAVE]: ['network-error'] })
    const api = makeWidgetApi<TestEvents>({
      typeId: 'notes/widget',
      instanceId: 'placement-1',
      http,
    })

    const result = await api.invoke('save', { value: 'hello' })

    expect(result).toBeInstanceOf(WidgetApiError)
    if (!(result instanceof WidgetApiError)) throw new Error('expected WidgetApiError')
    expect(result.code).toBe('network')
  })

  it('synthesizes the invalid_response code on an unparseable envelope', async () => {
    const { http } = makeScriptedHttp({
      [URL_SAVE]: [{ status: 200, body: { nonsense: true } }],
    })
    const api = makeWidgetApi<TestEvents>({
      typeId: 'notes/widget',
      instanceId: 'placement-1',
      http,
    })

    const result = await api.invoke('save', { value: 'hello' })

    expect(result).toBeInstanceOf(WidgetApiError)
    if (!(result instanceof WidgetApiError)) throw new Error('expected WidgetApiError')
    expect(result.code).toBe('invalid_response')
  })
})
