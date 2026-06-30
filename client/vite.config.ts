import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
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
      '@widgets': resolve(__dirname, '../widgets'),
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'development'),
  },
  build: {
    rolldownOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'react-vendor',
              test: /node_modules[\\/](react|react-dom)[\\/]/,
              priority: 20,
            },
            {
              name: 'grid-vendor',
              test: /node_modules[\\/](react-grid-layout|react-resizable)[\\/]/,
              priority: 18,
            },
            {
              name: 'reatom-vendor',
              test: /node_modules[\\/]@reatom[\\/]/,
              priority: 16,
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
      '../widgets/**/*.{test,spec}.?(c|m)[jt]s?(x)',
    ],
    environment: 'jsdom',
    setupFiles: ['./src/vitest.setup.ts'],
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
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY ?? 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  preview: {
    // Vite preview is a static server and 404s `/api`; the e2e harness serves
    // the production build here while routing the API (incl. the
    // `/api/storage/events` SSE stream) to the test server.
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY ?? 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
})
