import path from 'node:path'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(import.meta.dirname, '../shared'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/widget-setup.ts'],
    // The client's budget: these primitives' and dialogs' tests moved here from the client, and a
    // file's first jsdom render can take seconds while the whole workspace gate runs in parallel.
    testTimeout: 30000,
  },
})
