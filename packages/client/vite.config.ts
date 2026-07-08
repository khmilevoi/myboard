import fs from 'node:fs'
import type { IncomingMessage } from 'node:http'
import { extname, resolve } from 'node:path'

import { federation } from '@module-federation/vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { configDefaults, defineConfig } from 'vitest/config'
import { apiProxy, federationShared, stageWidgetBuilds, widgetRemotes } from 'widget-sdk/vite'

const widgetsDir = resolve(__dirname, '../widgets')
const portsFile = resolve(widgetsDir, '.ports.json')

const ACTIVATION_PATHS = new Set(['/activate', '/add-device'])
// The activation build's `base: '/activate/'` means its emitted HTML always
// references its own assets under this prefix, regardless of which
// ACTIVATION_PATHS route (`/activate` or `/add-device`) served that HTML.
const ACTIVATION_ASSET_PREFIX = '/activate/'

// A trailing slash (`/activate/`, `/add-device/`) is a distinct pathname from
// the bare route and must still match -- normalize before the membership check.
function stripTrailingSlash(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
}

function isActivationRoute(pathname: string): boolean {
  return ACTIVATION_PATHS.has(stripTrailingSlash(pathname))
}

// The standalone activation app (vite.activation.config.ts) builds into
// dist/activate/ alongside the board's own dist/. Extensionless requests for
// /activate or /add-device would otherwise be swallowed by the board's SPA
// fallback (serving the board's index.html); rewrite them to the
// activation app's index.html instead, in both dev and preview/production.
function rewriteActivationRequest(req: IncomingMessage) {
  if (!req.url) return
  const pathname = req.url.split('?')[0]
  if (isActivationRoute(pathname)) req.url = '/activate/index.html'
}

const activationDistDir = resolve(__dirname, 'dist/activate')
const activationDistIndex = resolve(activationDistDir, 'index.html')

const ACTIVATION_MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

function contentTypeFor(filePath: string): string {
  return ACTIVATION_MIME_TYPES[extname(filePath)] ?? 'application/octet-stream'
}

function activationRoutePlugin(): Plugin {
  return {
    name: 'activation-route',
    configureServer(server) {
      // `pnpm dev` runs this Vite dev server (no build step), so the rewrite
      // used by configurePreviewServer/production (-> /activate/index.html)
      // doesn't resolve to anything real here: there's no such source file,
      // and the standalone activation app isn't part of this dev server's
      // module graph. Serve the already-built activation app's whole dist/
      // directory as static -- both its HTML *and* the `/activate/assets/*`
      // it references -- if present; otherwise fail loudly instead of
      // silently falling through to the board's SPA shell.
      server.middlewares.use((req, res, next) => {
        if (!req.url) return next()
        const pathname = req.url.split('?')[0]
        const isRoot = isActivationRoute(pathname)
        const isAsset = pathname.startsWith(ACTIVATION_ASSET_PREFIX)
        if (!isRoot && !isAsset) return next()

        if (!fs.existsSync(activationDistIndex)) {
          res.statusCode = 404
          res.setHeader('Content-Type', 'text/plain')
          res.end(
            'Activation app not built. Run `pnpm --filter client build:activation`, then reload.',
          )
          return
        }

        const relPath = isRoot ? 'index.html' : pathname.slice(ACTIVATION_ASSET_PREFIX.length)
        const filePath = resolve(activationDistDir, relPath)
        if (!filePath.startsWith(activationDistDir) || !fs.existsSync(filePath)) {
          // Unknown sub-path under /activate/ (e.g. a client-side route) --
          // fall back to the activation app's own index.html, same as a real
          // static-file server configured with SPA history fallback would.
          res.setHeader('Content-Type', 'text/html')
          res.end(fs.readFileSync(activationDistIndex, 'utf-8'))
          return
        }

        res.setHeader('Content-Type', contentTypeFor(filePath))
        res.end(fs.readFileSync(filePath))
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, _res, next) => {
        rewriteActivationRequest(req)
        next()
      })
    },
  }
}

export default defineConfig(({ command }) => ({
  plugins: [
    ...(process.env.VITEST
      ? []
      : [
          federation({
            name: 'board',
            filename: 'remoteEntry.js',
            remotes: widgetRemotes({ command, portsFile }),
            shared: federationShared(),
            dev: { remoteHmr: true },
            manifest: false,
          }),
        ]),
    react(),
    tailwindcss(),
    activationRoutePlugin(),
    stageWidgetBuilds({ widgetsDir }),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null,
      manifest: {
        name: 'myboard',
        short_name: 'myboard',
        description: 'Personal widget board',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f7f5ef',
        theme_color: '#ffffff',
        icons: [
          {
            src: '/pwa-icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-icon.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: '/pwa-icon-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        // The activation surfaces are public and must always reach nginx:
        // without this denylist the installed SW serves the cached board
        // shell for them, and a revoked device loops through ceremonies
        // instead of landing on the activation page.
        navigateFallbackDenylist: [/^\/activate/, /^\/add-device/],
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,woff2}'],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'myboard-pages',
              networkTimeoutSeconds: 3,
              expiration: {
                maxEntries: 16,
                maxAgeSeconds: 7 * 24 * 60 * 60,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: ({ request, url }) => {
              const origin = (globalThis as unknown as { location: { origin: string } }).location
                .origin
              return (
                url.origin === origin &&
                url.pathname.startsWith('/api/') &&
                !url.pathname.endsWith('/events') &&
                request.method === 'GET'
              )
            },
            handler: 'NetworkFirst',
            options: {
              cacheName: 'myboard-api',
              networkTimeoutSeconds: 3,
              expiration: {
                maxEntries: 64,
                maxAgeSeconds: 24 * 60 * 60,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: ({ request, url }) => {
              const origin = (globalThis as unknown as { location: { origin: string } }).location
                .origin
              return (
                url.origin === origin &&
                ['script', 'style', 'font', 'worker'].includes(request.destination)
              )
            },
            handler: 'CacheFirst',
            options: {
              cacheName: 'myboard-static-assets',
              expiration: {
                maxEntries: 96,
                maxAgeSeconds: 30 * 24 * 60 * 60,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@shared': resolve(__dirname, '../shared'),
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'development'),
  },
  build: {
    // gzip-size reporting walks every emitted asset (incl. staged widget
    // remotes) and only affects console output — not worth the build time.
    reportCompressedSize: false,
    rolldownOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'grid-vendor',
              test: /node_modules[\\/](react-grid-layout|react-resizable)[\\/]/,
              priority: 18,
            },
            {
              name: 'storage-vendor',
              test: /node_modules[\\/](dexie|zod|errore)[\\/]/,
              priority: 14,
            },
            {
              name: 'ui-vendor',
              test: /node_modules[\\/](radix-ui|lucide-react)[\\/]/,
              priority: 12,
            },
          ],
        },
      },
    },
  },
  test: {
    globals: true,
    include: [
      'src/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'activation/src/**/*.{test,spec}.?(c|m)[jt]s?(x)',
    ],
    environment: 'jsdom',
    setupFiles: ['./src/vitest.setup.ts'],
    testTimeout: 30000,
    exclude: [...configDefaults.exclude, 'e2e/**'],
    execArgv: ['--harmony-temporal'],
  },
  server: {
    // Inside a Docker bind mount (notably on Windows/macOS) native FS events
    // don't propagate, so HMR misses changes. docker-compose.dev.yml sets
    // CHOKIDAR_USEPOLLING=true to switch the watcher to polling. Outside
    // Docker this is unset, so normal `pnpm dev` keeps native watching.
    watch:
      process.env.CHOKIDAR_USEPOLLING === 'true' ? { usePolling: true, interval: 100 } : undefined,
    proxy: apiProxy(),
  },
  preview: {
    // Vite preview is a static server and 404s `/api`; the e2e harness serves
    // the production build here while routing the API (incl. the
    // `/api/storage/events` SSE stream) to the test server.
    proxy: apiProxy(),
  },
}))
