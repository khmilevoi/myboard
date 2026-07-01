// @vitest-environment node
import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import { makeWidgetApi, WidgetApiError } from './widget-api'

type TestEvents = {
  save: {
    payload: { value: string }
    result: { id: string }
  }
}

describe('makeWidgetApi', () => {
  it('binds type and instance identity and returns typed data', async () => {
    const fetchRequest = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { id: 'entry-1' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const api = makeWidgetApi<TestEvents>({
      typeId: 'notes/widget',
      instanceId: 'placement-1',
      fetch: fetchRequest,
    })

    const result = await api.invoke('save', { value: 'hello' })

    expectTypeOf(result).toEqualTypeOf<WidgetApiError | { id: string }>()
    expect(result).toEqual({ id: 'entry-1' })
    expect(fetchRequest).toHaveBeenCalledWith('/api/widgets/notes%2Fwidget/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instanceId: 'placement-1', payload: { value: 'hello' } }),
    })
  })

  it('returns WidgetApiError for a safe server error envelope', async () => {
    const api = makeWidgetApi<TestEvents>({
      typeId: 'notes',
      instanceId: 'placement-1',
      fetch: async () =>
        new Response(
          JSON.stringify({
            error: { code: 'payload_invalid', message: 'Widget event payload is invalid' },
          }),
          { status: 422 },
        ),
    })

    const result = await api.invoke('save', { value: 'hello' })

    expect(result).toBeInstanceOf(WidgetApiError)
    expect((result as WidgetApiError).message).toContain('payload_invalid')
  })

  it('wraps network rejection as WidgetApiError with a cause', async () => {
    const cause = new Error('offline')
    const api = makeWidgetApi<TestEvents>({
      typeId: 'notes',
      instanceId: 'placement-1',
      fetch: async () => Promise.reject(cause),
    })

    const result = await api.invoke('save', { value: 'hello' })

    expect(result).toBeInstanceOf(WidgetApiError)
    expect((result as WidgetApiError).cause).toBe(cause)
  })
})
