import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'

configure({ asyncUtilTimeout: 30000 })

// jsdom lacks ResizeObserver; react-grid-layout v2's useContainerWidth needs it.
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver =
  globalThis.ResizeObserver ?? (ResizeObserverMock as unknown as typeof ResizeObserver)

// jsdom lacks matchMedia; the theme model reads prefers-color-scheme.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() {
      return false
    },
  })) as unknown as typeof window.matchMedia
}

// jsdom lacks BroadcastChannel; the storage layer broadcasts key changes across tabs.
// Passive in-memory polyfill — tests that need to control it use vi.stubGlobal instead.
if (typeof globalThis.BroadcastChannel === 'undefined') {
  const peers = new Map<string, Set<BroadcastChannelPolyfill>>()
  class BroadcastChannelPolyfill {
    onmessage: ((event: MessageEvent) => void) | null = null
    private listeners = new Set<(event: MessageEvent) => void>()
    constructor(public name: string) {
      const set = peers.get(name) ?? new Set()
      set.add(this)
      peers.set(name, set)
    }
    addEventListener(_type: 'message', listener: (event: MessageEvent) => void) {
      this.listeners.add(listener)
    }
    removeEventListener(_type: 'message', listener: (event: MessageEvent) => void) {
      this.listeners.delete(listener)
    }
    postMessage(data: unknown) {
      for (const peer of peers.get(this.name) ?? []) {
        if (peer === this) continue
        const event = { data } as MessageEvent
        peer.onmessage?.(event)
        for (const listener of peer.listeners) listener(event)
      }
    }
    close() {
      peers.get(this.name)?.delete(this)
    }
  }
  globalThis.BroadcastChannel = BroadcastChannelPolyfill as unknown as typeof BroadcastChannel
}

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
