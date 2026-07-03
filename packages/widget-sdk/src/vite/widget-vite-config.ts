import { basename, resolve } from 'node:path'

import { federation } from '@module-federation/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { defineConfig as defineVitestConfig } from 'vitest/config'

import { federationShared } from './federation-shared.ts'
import { apiProxy } from './vite-dev-config.ts'
import { readWidgetPort } from './widget-remotes.ts'

/** Federation remote + standalone dev/preview server for one widget package. */
export function defineWidgetViteConfig(widgetDir: string) {
  const id = basename(widgetDir)
  const port = readWidgetPort(id, resolve(widgetDir, '..', '.ports.json'))

  return defineConfig(({ command }: { command: 'build' | 'serve' }) => ({
    base: command === 'build' ? `/widgets/${id}/` : '/',
    plugins: [
      federation({
        name: id,
        filename: 'remoteEntry.js',
        exposes: { './client': './client.ts' },
        shared: federationShared(),
        dev: { remoteHmr: true },
        manifest: false,
        dts: false,
      }),
      react(),
    ],
    resolve: {
      alias: {
        '@': widgetDir,
        '@shared': resolve(widgetDir, '..', '..', 'shared'),
      },
    },
    server: {
      port,
      strictPort: true,
      origin: `http://localhost:${port}`,
      proxy: apiProxy(),
    },
    preview: {
      port,
      strictPort: true,
      proxy: apiProxy(),
    },
  }))
}

/** Per-widget vitest (jsdom + shared setup). Kept separate from the federation
 *  vite config so the federation plugin never runs during tests. */
export function defineWidgetVitestConfig(widgetDir: string) {
  return defineVitestConfig({
    resolve: {
      alias: {
        '@': widgetDir,
        '@shared': resolve(widgetDir, '..', '..', 'shared'),
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['widget-sdk/test-setup'],
      execArgv: ['--harmony-temporal'],
    },
  })
}
