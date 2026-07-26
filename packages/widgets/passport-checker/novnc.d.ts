// Minimal ambient types for @novnc/novnc@1.7.0 (the package ships no .d.ts).
// Only the surface the recovery panel touches; see docs/API.md in the package.
declare module '@novnc/novnc' {
  export type NoVncCredentials = { username?: string; password?: string; target?: string }
  export type NoVncOptions = {
    shared?: boolean
    credentials?: NoVncCredentials
    repeaterID?: string
    wsProtocols?: string[]
  }

  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, urlOrChannel: string | WebSocket, options?: NoVncOptions)
    disconnect(): void
    focus(options?: FocusOptions): void
    blur(): void
    scaleViewport: boolean
    clipViewport: boolean
    resizeSession: boolean
    viewOnly: boolean
    background: string
  }
}
