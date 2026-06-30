import path from 'node:path'

import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(import.meta.dirname, '../shared'),
      '@widgets': path.resolve(import.meta.dirname, '../widgets'),
    },
  },
  test: {
    environment: 'node',

    include: ['src/**/*.{test,spec}.{ts,tsx}', '../widgets/**/*.{test,spec}.{ts,tsx}'],

    exclude: [
      ...configDefaults.exclude,
      '../widgets/node_modules/**',
      '../widgets/**/node_modules/**',
    ],
  },
})
