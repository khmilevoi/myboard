if (typeof globalThis.EventSource === 'undefined') {
  class EventSourcePolyfill {
    onmessage: ((event: MessageEvent) => void) | null = null
    constructor(public url: string) {}
    addEventListener() {}
    removeEventListener() {}
    close() {}
  }
  globalThis.EventSource = EventSourcePolyfill as unknown as typeof EventSource
}

// @ts-expect-error node:vm is a Node builtin not typed in browser context
import vm from 'node:vm'
try {
  const nodeGlobalTemporal = vm.runInThisContext('Temporal')
  if (nodeGlobalTemporal) {
    ;(globalThis as any).Temporal = nodeGlobalTemporal
  }
} catch {
  // Ignore
}
