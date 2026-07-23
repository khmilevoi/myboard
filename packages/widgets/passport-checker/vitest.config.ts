import path from 'node:path'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': import.meta.dirname,
      '@shared': path.resolve(import.meta.dirname, '../../shared'),
    },
  },
  test: { environment: 'node' },
})
