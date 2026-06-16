import { BridgeError, HandshakeTimeoutError } from './errors'
import { parseHostMessage } from './parse'
import type { ResolvedTheme } from '../theme/types'
import type { WidgetMessage, WidgetMode } from './messages'

export type WidgetClient = {
  instanceId: string
  mode: WidgetMode
  theme: ResolvedTheme
  requestFullscreen: () => void
  requestClose: () => void
  reportError: (error: Error) => void
  onModeChange: (cb: (mode: WidgetMode) => void) => () => void
  onThemeChange: (cb: (theme: ResolvedTheme) => void) => () => void
}

export type CreateWidgetClientOptions = {
  timeoutMs?: number
  target?: Window
}

export function createWidgetClient(
  options: CreateWidgetClientOptions = {},
): Promise<BridgeError | HandshakeTimeoutError | WidgetClient> {
  const timeoutMs = options.timeoutMs ?? 5000
  const target = options.target ?? window

  return new Promise((resolve) => {
    const modeChangeListeners = new Set<(mode: WidgetMode) => void>()
    const themeChangeListeners = new Set<(theme: ResolvedTheme) => void>()

    const timer = setTimeout(() => {
      target.removeEventListener('message', onWindowMessage)
      resolve(new HandshakeTimeoutError({ instanceId: 'unknown', timeoutMs }))
    }, timeoutMs)

    function onWindowMessage(event: MessageEvent) {
      const parsed = parseHostMessage(event.data)
      if (parsed instanceof Error) return
      if (parsed.type !== 'init') return

      const port = event.ports[0]
      if (!port) {
        clearTimeout(timer)
        target.removeEventListener('message', onWindowMessage)
        resolve(new BridgeError({ reason: 'init message carried no MessagePort' }))
        return
      }

      clearTimeout(timer)
      target.removeEventListener('message', onWindowMessage)

      const { instanceId, mode, theme } = parsed

      port.onmessage = (portEvent: MessageEvent) => {
        const hostMsg = parseHostMessage(portEvent.data)
        if (hostMsg instanceof Error) return
        if (hostMsg.type === 'mode-change') {
          modeChangeListeners.forEach((cb) => cb(hostMsg.mode))
        }
        if (hostMsg.type === 'theme-change') {
          themeChangeListeners.forEach((cb) => cb(hostMsg.theme))
        }
      }
      port.start()

      const send = (message: WidgetMessage) => port.postMessage(message)
      send({ type: 'ready', instanceId })

      resolve({
        instanceId,
        mode,
        theme,
        requestFullscreen: () => send({ type: 'request-fullscreen', instanceId }),
        requestClose: () => send({ type: 'request-close', instanceId }),
        reportError: (error: Error) =>
          send({ type: 'error', message: error.message, name: error.name }),
        onModeChange: (cb) => {
          modeChangeListeners.add(cb)
          return () => modeChangeListeners.delete(cb)
        },
        onThemeChange: (cb) => {
          themeChangeListeners.add(cb)
          return () => themeChangeListeners.delete(cb)
        },
      })
    }

    target.addEventListener('message', onWindowMessage)
  })
}
