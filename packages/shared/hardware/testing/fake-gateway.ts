// A scripted gateway for server and e2e tests. Uses only fetch and web streams, so Playwright
// specs can reuse it outside Node.
import {
  type GatewayCommand,
  GatewayCommandSchema,
  type GatewayEvent,
  type GatewayReading,
  GatewayRegisterResponseSchema,
} from '../gateway-protocol'

export type FakeGatewayStream = {
  ready: { gatewayId: string }
  /** Resolves with the next command of `type`, skipping others; rejects once the stream ends. */
  nextCommand<T extends GatewayCommand['type']>(
    type: T,
  ): Promise<Extract<GatewayCommand, { type: T }>>
  /** Resolves with the next command of any type; rejects once the stream ends. */
  nextCommand(): Promise<GatewayCommand>
  close(): void
}

export type FakeGateway = {
  register(code: string, label?: string): Promise<void>
  readonly token: string
  readonly gatewayId: string
  openStream(): Promise<FakeGatewayStream>
  postEvents(events: GatewayEvent[]): Promise<Response>
  postReadings(readings: GatewayReading[]): Promise<Response>
}

type SseFrame = { event: string | null; data: string | null }

function parseFrame(block: string): SseFrame {
  let event: string | null = null
  const data: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith('event: ')) event = line.slice('event: '.length)
    else if (line.startsWith('data: ')) data.push(line.slice('data: '.length))
  }
  return { event, data: data.length === 0 ? null : data.join('\n') }
}

export function makeFakeGateway(base: string): FakeGateway {
  let token: string | null = null
  let gatewayId: string | null = null

  const authHeaders = (): Record<string, string> =>
    token === null ? {} : { authorization: `Bearer ${token}` }

  const postJson = (path: string, body: unknown): Promise<Response> =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    })

  return {
    get token() {
      if (token === null) throw new Error('fake gateway is not registered')
      return token
    },
    get gatewayId() {
      if (gatewayId === null) throw new Error('fake gateway is not registered')
      return gatewayId
    },

    async register(code, label = 'Test gateway') {
      const res = await postJson('/api/hardware/gateway/register', { code, label })
      if (res.status !== 201) throw new Error(`gateway register failed: ${res.status}`)
      const parsed = GatewayRegisterResponseSchema.parse(await res.json())
      token = parsed.token
      gatewayId = parsed.gatewayId
    },

    async openStream() {
      const controller = new AbortController()
      const res = await fetch(`${base}/api/hardware/gateway/stream`, {
        headers: authHeaders(),
        signal: controller.signal,
      })
      if (res.status !== 200 || res.body === null) {
        controller.abort()
        throw new Error(`gateway stream failed: ${res.status}`)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      const nextFrame = async (): Promise<SseFrame> => {
        for (;;) {
          const at = buffer.indexOf('\n\n')
          if (at >= 0) {
            const block = buffer.slice(0, at)
            buffer = buffer.slice(at + 2)
            const frame = parseFrame(block)
            // Comment-only blocks (`: ping`) carry no frame.
            if (frame.event === null && frame.data === null) continue
            return frame
          }
          const chunk = await reader.read()
          if (chunk.done) throw new Error('gateway stream ended')
          buffer += decoder.decode(chunk.value, { stream: true })
        }
      }

      const first = await nextFrame()
      if (first.event !== 'ready' || first.data === null) {
        controller.abort()
        throw new Error('gateway stream did not start with ready')
      }
      const ready = JSON.parse(first.data) as { gatewayId: string }

      async function nextCommand(type?: GatewayCommand['type']): Promise<GatewayCommand> {
        for (;;) {
          const frame = await nextFrame()
          if (frame.event !== 'command' || frame.data === null) continue
          const command = GatewayCommandSchema.parse(JSON.parse(frame.data))
          if (type === undefined || command.type === type) return command
        }
      }

      return {
        ready,
        // The overloads narrow the result by `type`; the filter above guarantees the match.
        nextCommand: nextCommand as FakeGatewayStream['nextCommand'],
        close: () => controller.abort(),
      }
    },

    postEvents: (events) => postJson('/api/hardware/gateway/events', { events }),
    postReadings: (readings) => postJson('/api/hardware/gateway/readings', { readings }),
  }
}
