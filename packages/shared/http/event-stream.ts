export type EventStreamMessage = { event?: string; data: string }

export type EventStreamHandlers = {
  onMessage: (message: EventStreamMessage) => void
  /** Fires only when the stream is dead (CLOSED) and will not retry by itself. */
  onError?: () => void
  /** Named SSE events to forward in addition to plain `message` frames. */
  events?: string[]
}

export type EventStream = { close(): void }

export type OpenEventStream = (url: string, handlers: EventStreamHandlers) => EventStream

const CLOSED = 2

export function makeEventSourceStream(
  EventSourceImpl: typeof EventSource = globalThis.EventSource,
): OpenEventStream {
  return (url, handlers) => {
    const source = new EventSourceImpl(url)
    source.onmessage = (event) => handlers.onMessage({ data: event.data as string })
    for (const name of handlers.events ?? []) {
      source.addEventListener(name, (event) =>
        handlers.onMessage({ event: name, data: (event as MessageEvent).data as string }),
      )
    }
    source.onerror = () => {
      // CONNECTING (0): the browser retries by itself. CLOSED (2): fatal —
      // e.g. the gate answered non-200 and EventSource will never reconnect.
      if (source.readyState === CLOSED) handlers.onError?.()
    }
    return { close: () => source.close() }
  }
}
