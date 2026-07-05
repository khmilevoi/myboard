import {
  BrowserAutomationDeadlineError,
  BrowserAutomationProtocolError,
  BrowserAutomationUnavailableError,
  BrowserTaskRejectedError,
} from '@shared/widgets/browser-errors'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createHttpBrowserAutomationClient } from './http-client'

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function fetchReturning(value: Response) {
  return vi.fn(async () => value) as unknown as typeof fetch
}

afterEach(() => {
  vi.useRealTimers()
})

describe('createHttpBrowserAutomationClient', () => {
  it('posts the scoped task and returns a success result', async () => {
    const fetchImpl = fetchReturning(response({ ok: true, result: { echoed: 'ok' } }))
    const client = createHttpBrowserAutomationClient({
      baseUrl: 'http://browser:8788',
      timeoutMs: 1000,
      fetchImpl,
    })

    expect(
      await client.invoke({
        widgetId: 'demo widget',
        taskId: 'check/value',
        payload: { value: 'ok' },
      }),
    ).toEqual({ result: { echoed: 'ok' } })
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://browser:8788/tasks/demo%20widget/check%2Fvalue',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ payload: { value: 'ok' } }),
      }),
    )
  })

  it('preserves a valid remote task rejection', async () => {
    const client = createHttpBrowserAutomationClient({
      baseUrl: 'http://browser:8788',
      timeoutMs: 1000,
      fetchImpl: fetchReturning(
        response({
          ok: false,
          error: {
            code: 'browser_session_required',
            message: 'Browser attention is required',
            meta: { recovery: 'ssh' },
          },
        }),
      ),
    })

    const result = await client.invoke({ widgetId: 'demo', taskId: 'check', payload: {} })
    expect(result).toBeInstanceOf(BrowserTaskRejectedError)
    expect(result).toMatchObject({
      code: 'browser_session_required',
      publicMessage: 'Browser attention is required',
      meta: { recovery: 'ssh' },
    })
  })

  it('maps a draining service and fetch rejection to unavailable errors', async () => {
    const draining = createHttpBrowserAutomationClient({
      baseUrl: 'http://browser:8788',
      timeoutMs: 1000,
      fetchImpl: fetchReturning(response({ status: 'draining' }, 503)),
    })
    expect(await draining.invoke({ widgetId: 'demo', taskId: 'check', payload: {} })).toBeInstanceOf(
      BrowserAutomationUnavailableError,
    )

    const rejectedFetch = vi.fn(async () => {
      throw new Error('connection refused')
    }) as unknown as typeof fetch
    const unavailable = createHttpBrowserAutomationClient({
      baseUrl: 'http://browser:8788',
      timeoutMs: 1000,
      fetchImpl: rejectedFetch,
    })
    expect(
      await unavailable.invoke({ widgetId: 'demo', taskId: 'check', payload: {} }),
    ).toBeInstanceOf(BrowserAutomationUnavailableError)
  })

  it('aborts with a typed deadline error', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
        }),
    ) as unknown as typeof fetch
    const client = createHttpBrowserAutomationClient({
      baseUrl: 'http://browser:8788',
      timeoutMs: 100,
      fetchImpl,
    })

    const pending = client.invoke({ widgetId: 'demo', taskId: 'check', payload: {} })
    await vi.advanceTimersByTimeAsync(100)
    expect(await pending).toBeInstanceOf(BrowserAutomationDeadlineError)
  })

  it.each([
    ['unexpected status', fetchReturning(response({ message: 'bad' }, 502))],
    ['invalid json', fetchReturning(new Response('{', { status: 200 }))],
    ['invalid envelope', fetchReturning(response({ ok: true, secret: 'SERIES123456' }))],
  ])('returns a protocol error for %s', async (_label, fetchImpl) => {
    const client = createHttpBrowserAutomationClient({
      baseUrl: 'http://browser:8788',
      timeoutMs: 1000,
      fetchImpl,
    })
    const result = await client.invoke({
      widgetId: 'demo',
      taskId: 'check',
      payload: { secret: 'PAYLOAD_SECRET' },
    })
    expect(result).toBeInstanceOf(BrowserAutomationProtocolError)
    expect(JSON.stringify(result)).not.toContain('SERIES123456')
    expect(JSON.stringify(result)).not.toContain('PAYLOAD_SECRET')
  })

  it('does not retry a failed request', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('connection refused')
    }) as unknown as typeof fetch
    const client = createHttpBrowserAutomationClient({
      baseUrl: 'http://browser:8788',
      timeoutMs: 1000,
      fetchImpl,
    })

    await client.invoke({ widgetId: 'demo', taskId: 'check', payload: {} })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
