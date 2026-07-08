import type { EventStream, EventStreamHandlers, OpenEventStream } from '../event-stream'

/** In-memory EventStream double: capture opened streams and push frames manually. */
export class FakeEventStream implements EventStream {
  closed = false
  constructor(
    public url: string,
    public handlers: EventStreamHandlers,
  ) {}
  /** Simulate a server frame; `event` undefined = plain message. */
  emit(event: string | undefined, data: unknown) {
    this.handlers.onMessage({ event, data: JSON.stringify(data) })
  }
  /** Simulate a fatal close (e.g. the gate answered 401). */
  fail() {
    this.handlers.onError?.()
  }
  close() {
    this.closed = true
  }
}

export function makeFakeOpenEventStream() {
  const streams: FakeEventStream[] = []
  const open: OpenEventStream = (url, handlers) => {
    const stream = new FakeEventStream(url, handlers)
    streams.push(stream)
    return stream
  }
  return { open, streams }
}
