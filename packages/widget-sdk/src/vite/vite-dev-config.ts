/** Proxy config so a widget dev server (own port) reaches the storage API same-origin. */
type GlobalWithProcess = typeof globalThis & {
  process?: {
    env?: Record<string, string | undefined>
  }
}

export function apiProxy(
  target = (globalThis as GlobalWithProcess).process?.env?.VITE_API_PROXY ??
    'http://localhost:8787',
) {
  return {
    // Vite only proxies an upgrade when `ws` is set, and the generic /api entry
    // must stay non-ws so SSE and plain requests are untouched.
    '/api/browser/recovery/socket': {
      target,
      changeOrigin: true,
      ws: true,
    },
    '/api': {
      target,
      changeOrigin: true,
    },
  }
}
