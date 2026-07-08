import { describe, expect, it, vi } from 'vitest'

import { makeEventSourceStream } from './event-stream'

class FakeES {
  static instances: FakeES[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  readyState = 0
  closed = false
  listeners = new Map<string, (event: MessageEvent) => void>()
  constructor(public url: string) {
    FakeES.instances.push(this)
  }
  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, listener)
  }
  close() {
    this.closed = true
  }
}

function open(events?: string[]) {
  FakeES.instances = []
  const onMessage = vi.fn()
  const onError = vi.fn()
  const stream = makeEventSourceStream(FakeES as unknown as typeof EventSource)('/api/x/events', {
    onMessage,
    onError,
    events,
  })
  return { stream, source: FakeES.instances[0], onMessage, onError }
}

describe('makeEventSourceStream', () => {
  it('forwards plain messages without an event tag', () => {
    const { source, onMessage } = open()
    source.onmessage?.({ data: '{"key":"k"}' } as MessageEvent)
    expect(onMessage).toHaveBeenCalledWith({ data: '{"key":"k"}' })
  })

  it('forwards named events with their tag', () => {
    const { source, onMessage } = open(['ready'])
    source.listeners.get('ready')?.({ data: '{"connId":"c1"}' } as MessageEvent)
    expect(onMessage).toHaveBeenCalledWith({ event: 'ready', data: '{"connId":"c1"}' })
  })

  it('fires onError only when the source is CLOSED (fatal)', () => {
    const { source, onError } = open()
    source.readyState = 0 // CONNECTING: the browser retries by itself
    source.onerror?.()
    expect(onError).not.toHaveBeenCalled()
    source.readyState = 2 // CLOSED: fatal, e.g. the gate answered 401
    source.onerror?.()
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('close() closes the underlying source', () => {
    const { stream, source } = open()
    stream.close()
    expect(source.closed).toBe(true)
  })
})
