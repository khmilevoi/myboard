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
    '/api': {
      target,
      changeOrigin: true,
    },
  }
}
