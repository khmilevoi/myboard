import { HandshakeTimeoutError, parseWidgetMessage } from '../shared/widget-bridge'
import type { HostMessage, ResolvedTheme, WidgetErrorMessage, WidgetMode } from '../shared/widget-bridge'

export type WidgetConnectionHandlers = {
  onReady?: () => void
  onRequestFullscreen?: () => void
  onRequestClose?: () => void
  onWidgetError?: (message: WidgetErrorMessage) => void
}

export type CreateWidgetConnectionOptions = {
  instanceId: string
  mode: WidgetMode
  targetOrigin: string
  theme: ResolvedTheme
  handlers: WidgetConnectionHandlers
}

export type WidgetConnection = {
  handshake: (contentWindow: Window, timeoutMs?: number) => Promise<HandshakeTimeoutError | void>
  send: (message: HostMessage) => void
  close: () => void
}

export function createWidgetConnection(options: CreateWidgetConnectionOptions): WidgetConnection {
  const { instanceId, mode, targetOrigin, theme, handlers } = options
  const channel = new MessageChannel()
  let closed = false

  channel.port1.onmessage = (event: MessageEvent) => {
    const message = parseWidgetMessage(event.data)
    if (message instanceof Error) {
      console.warn(`[widget ${instanceId}] invalid message:`, message.message)
      return
    }
    if (message.type === 'ready') return handlers.onReady?.()
    if (message.type === 'request-fullscreen') return handlers.onRequestFullscreen?.()
    if (message.type === 'request-close') return handlers.onRequestClose?.()
    if (message.type === 'error') return handlers.onWidgetError?.(message)
  }
  channel.port1.start()

  function handshake(contentWindow: Window, timeoutMs = 5000): Promise<HandshakeTimeoutError | void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve(new HandshakeTimeoutError({ instanceId, timeoutMs }))
      }, timeoutMs)

      const userOnReady = handlers.onReady
      handlers.onReady = () => {
        clearTimeout(timer)
        handlers.onReady = userOnReady
        userOnReady?.()
        resolve()
      }

      const init: HostMessage = { type: 'init', instanceId, mode, theme }
      contentWindow.postMessage(init, targetOrigin, [channel.port2])
    })
  }

  function send(message: HostMessage) {
    if (closed) return
    channel.port1.postMessage(message)
  }

  function close() {
    closed = true
    channel.port1.onmessage = null
    channel.port1.close()
  }

  return { handshake, send, close }
}
