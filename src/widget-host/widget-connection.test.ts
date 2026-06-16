// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createWidgetConnection } from './widget-connection'
import { HandshakeTimeoutError } from '../shared/widget-bridge'
import type { HostMessage } from '../shared/widget-bridge'

function fakeWidgetWindow(instanceId: string, sink: HostMessage[]) {
  return {
    postMessage(message: unknown, _targetOrigin: string, transfer?: Transferable[]) {
      const port = transfer?.[0] as MessagePort | undefined
      if (!port) return
      port.onmessage = (e: MessageEvent) => sink.push(e.data as HostMessage)
      port.start()
      port.postMessage({ type: 'ready', instanceId })
      void message
    },
  } as unknown as Window
}

describe('createWidgetConnection', () => {
  it('resolves after the widget replies ready', async () => {
    const sink: HostMessage[] = []
    const conn = createWidgetConnection({
      instanceId: 'inst-1',
      mode: 'small',
      targetOrigin: 'http://localhost',
      theme: 'light',
      handlers: {},
    })

    const result = await conn.handshake(fakeWidgetWindow('inst-1', sink), 1000)
    expect(result).toBeUndefined()
    conn.close()
  })

  it('invokes onRequestFullscreen when the widget asks', async () => {
    const sink: HostMessage[] = []
    const onRequestFullscreen = vi.fn()
    const channelWindow = {
      postMessage(_m: unknown, _o: string, transfer?: Transferable[]) {
        const port = transfer?.[0] as MessagePort
        port.start()
        port.postMessage({ type: 'ready', instanceId: 'inst-2' })
        port.postMessage({ type: 'request-fullscreen', instanceId: 'inst-2' })
      },
    } as unknown as Window

    const conn = createWidgetConnection({
      instanceId: 'inst-2',
      mode: 'small',
      targetOrigin: 'http://localhost',
      theme: 'light',
      handlers: { onRequestFullscreen },
    })
    await conn.handshake(channelWindow, 1000)
    await vi.waitFor(() => expect(onRequestFullscreen).toHaveBeenCalledTimes(1))
    conn.close()
    void sink
  })

  it('rejects with HandshakeTimeoutError when ready never arrives', async () => {
    const silentWindow = { postMessage() {} } as unknown as Window
    const conn = createWidgetConnection({
      instanceId: 'inst-3',
      mode: 'small',
      targetOrigin: 'http://localhost',
      theme: 'light',
      handlers: {},
    })
    const result = await conn.handshake(silentWindow, 20)
    expect(result).toBeInstanceOf(HandshakeTimeoutError)
    conn.close()
  })
})
