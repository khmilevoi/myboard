import { describe, expect, it, vi } from 'vitest'
import { parseHostMessage, parseWidgetMessage } from '../src/shared/widget-bridge'
import { createWidgetConnection } from '../src/widget-host/widget-connection'

function attachFakeWidget(port: MessagePort, instanceId: string) {
  port.onmessage = (event: MessageEvent) => {
    const msg = parseHostMessage(event.data)
    if (msg instanceof Error) return
    if (msg.type === 'init') {
      port.postMessage({ type: 'ready', instanceId })
      port.postMessage({ type: 'request-fullscreen', instanceId })
    }
  }
  port.start()
}

describe('host <-> widget handshake (integration)', () => {
  it('completes handshake and routes request-fullscreen', async () => {
    const onRequestFullscreen = vi.fn()
    const onReady = vi.fn()

    const fakeWindow = {
      postMessage(message: unknown, _origin: string, transfer?: Transferable[]) {
        const port = transfer?.[0] as MessagePort
        attachFakeWidget(port, 'inst-int')
        port.onmessage?.({ data: message } as MessageEvent)
      },
    } as unknown as Window

    const conn = createWidgetConnection({
      instanceId: 'inst-int',
      mode: 'small',
      targetOrigin: '*',
      theme: 'light',
      handlers: { onReady, onRequestFullscreen },
    })

    const result = await conn.handshake(fakeWindow, 1000)
    expect(result).toBeUndefined()
    expect(onReady).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(onRequestFullscreen).toHaveBeenCalledTimes(1))

    expect(parseWidgetMessage({ type: 'ready', instanceId: 'x' })).toEqual({
      type: 'ready',
      instanceId: 'x',
    })
    conn.close()
  })
})
