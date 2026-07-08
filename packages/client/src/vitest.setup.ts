// jsdom lacks indexedDB; without it Dexie's failed open hard-kills the vitest
// fork (silent worker exit) the moment a storage-backed atom connects.
import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'
import { beforeEach } from 'vitest'
import { resetClientStorage } from 'widget-runtime/storage/test/fakes'

// The Dexie db behind client storage is a module singleton: rows and in-flight
// write publishes leak across tests, clobbering board state set by the next
// test (see withStorageKey's connect delivery). Reset before each test, after
// the previous test's cleanup has disconnected all storage subscriptions.
beforeEach(async () => {
  await resetClientStorage()
})

// `@vitest-environment node` files (e.g. board-storage.test.ts) have no
// `location` at all, unlike jsdom. HttpClient falls back to
// `location.origin` to turn the app's relative `/api/...` calls into an
// absolute URL (browsers do this resolution against document.baseURI for
// free; ky/undici's Request constructor requires it explicit). Without a
// stand-in, ky throws building the Request before the fetch stub below is
// ever reached.
if (typeof globalThis.location === 'undefined') {
  globalThis.location = new URL('http://localhost/') as unknown as Location
}

// Node's fetch rejects the app's relative `/api` URLs outright, so every
// server-scope storage call fails. A persistently failing backend feeds the
// reactive graph an endless error/revert re-run cycle (withStorageKey +
// module-level effects) — a microtask storm that starves timers and livelocks
// the vitest fork. Serve the storage contract's "empty backend" instead:
// GET → 404 (no value), listing → empty, writes → ok. Tests that need real
// fetch behavior stub their own via vi.stubGlobal.
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
  if (url.startsWith('/api/')) {
    if (method === 'GET') {
      return url.includes('?prefix=')
        ? Response.json({ keys: [] })
        : new Response(null, { status: 404 })
    }
    return Response.json({})
  }
  return new Response(null, { status: 404 })
}) as typeof fetch

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
