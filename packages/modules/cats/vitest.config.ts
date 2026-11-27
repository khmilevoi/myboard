import path from 'node:path'

import { defineConfig } from 'vitest/config'

// Two projects: the domain, the models and the pure helpers run in `node`, as before; `ui/` holds
// React components and runs in `jsdom` with the setup every widget package uses.
export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(import.meta.dirname, '../../shared'),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['**/*.test.ts'],
          exclude: ['ui/**', 'node_modules/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'ui',
          globals: true,
          environment: 'jsdom',
          setupFiles: ['widget-sdk/test-setup'],
          include: ['ui/**/*.test.{ts,tsx}'],
          // A file's first jsdom render can take seconds while the whole workspace gate runs.
          testTimeout: 30000,
        },
      },
    ],
  },
})
