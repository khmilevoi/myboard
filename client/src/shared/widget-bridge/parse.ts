import { BridgeError } from './errors'
import type { HostMessage, WidgetMessage, WidgetMode } from './messages'
import type { ResolvedTheme } from '../theme/types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isMode(value: unknown): value is WidgetMode {
  return value === 'small' || value === 'large'
}

function isTheme(value: unknown): value is ResolvedTheme {
  return value === 'light' || value === 'dark'
}

export function parseHostMessage(data: unknown): BridgeError | HostMessage {
  if (!isRecord(data)) return new BridgeError({ reason: 'message is not an object' })

  if (data.type === 'init') {
    if (typeof data.instanceId !== 'string') {
      return new BridgeError({ reason: 'init.instanceId must be a string' })
    }
    if (!isMode(data.mode)) return new BridgeError({ reason: 'init.mode is invalid' })
    if (data.theme !== undefined && !isTheme(data.theme)) {
      return new BridgeError({ reason: 'init.theme is invalid' })
    }
    const theme: ResolvedTheme = isTheme(data.theme) ? data.theme : 'light'
    return { type: 'init', instanceId: data.instanceId, mode: data.mode, theme }
  }

  if (data.type === 'mode-change') {
    if (!isMode(data.mode)) return new BridgeError({ reason: 'mode-change.mode is invalid' })
    return { type: 'mode-change', mode: data.mode }
  }

  if (data.type === 'theme-change') {
    if (!isTheme(data.theme)) return new BridgeError({ reason: 'theme-change.theme is invalid' })
    return { type: 'theme-change', theme: data.theme }
  }

  if (data.type === 'ping') return { type: 'ping' }

  return new BridgeError({ reason: `unknown host message type: ${String(data.type)}` })
}

export function parseWidgetMessage(data: unknown): BridgeError | WidgetMessage {
  if (!isRecord(data)) return new BridgeError({ reason: 'message is not an object' })

  if (data.type === 'ready') {
    if (typeof data.instanceId !== 'string') {
      return new BridgeError({ reason: 'ready.instanceId must be a string' })
    }
    return { type: 'ready', instanceId: data.instanceId }
  }

  if (data.type === 'request-fullscreen') {
    if (typeof data.instanceId !== 'string') {
      return new BridgeError({ reason: 'request-fullscreen.instanceId must be a string' })
    }
    return { type: 'request-fullscreen', instanceId: data.instanceId }
  }

  if (data.type === 'request-close') {
    if (typeof data.instanceId !== 'string') {
      return new BridgeError({ reason: 'request-close.instanceId must be a string' })
    }
    return { type: 'request-close', instanceId: data.instanceId }
  }

  if (data.type === 'error') {
    if (typeof data.message !== 'string') {
      return new BridgeError({ reason: 'error.message must be a string' })
    }
    if (data.name !== undefined && typeof data.name !== 'string') {
      return new BridgeError({ reason: 'error.name must be a string' })
    }
    return data.name === undefined
      ? { type: 'error', message: data.message }
      : { type: 'error', message: data.message, name: data.name }
  }

  if (data.type === 'pong') return { type: 'pong' }

  return new BridgeError({ reason: `unknown widget message type: ${String(data.type)}` })
}
