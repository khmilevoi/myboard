import type { ResolvedTheme } from '../theme/types'

export type WidgetMode = 'small' | 'large'

// host -> widget
export type InitMessage = {
  type: 'init'
  instanceId: string
  mode: WidgetMode
  theme: ResolvedTheme
}
export type ModeChangeMessage = { type: 'mode-change'; mode: WidgetMode }
export type ThemeChangeMessage = { type: 'theme-change'; theme: ResolvedTheme }
export type PingMessage = { type: 'ping' }
export type HostMessage = InitMessage | ModeChangeMessage | ThemeChangeMessage | PingMessage

// widget -> host
export type ReadyMessage = { type: 'ready'; instanceId: string }
export type RequestFullscreenMessage = { type: 'request-fullscreen'; instanceId: string }
export type RequestCloseMessage = { type: 'request-close'; instanceId: string }
export type WidgetErrorMessage = { type: 'error'; message: string; name?: string }
export type PongMessage = { type: 'pong' }
export type WidgetMessage =
  | ReadyMessage
  | RequestFullscreenMessage
  | RequestCloseMessage
  | WidgetErrorMessage
  | PongMessage

export type { ResolvedTheme, ThemeMode } from '../theme/types'
