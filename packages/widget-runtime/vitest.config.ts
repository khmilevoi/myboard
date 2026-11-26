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
    setupFiles: ['./vitest.setup.ts'],
    // Same budget as the client project. Under a loaded machine a jsdom
    // file's first test also pays the cold import of everything it renders;
    // a 5 s default turned that into timeout flakes, not caught bugs.
    testTimeout: 30_000,
  },
})
