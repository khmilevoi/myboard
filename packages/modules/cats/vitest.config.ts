import path from 'node:path'

import { defineConfig } from 'vitest/config'

// One project: the workspace runs every package as a single project of the root config, so nested
// `projects` here would be ignored. The domain, the models and the pure helpers run in `node`; each
// React test in `ui/` opts into jsdom with a `@vitest-environment jsdom` docblock, and the shared
// setup guards its browser-only parts for the node files.
export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(import.meta.dirname, '../../shared'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['widget-sdk/test-setup'],
    // Same budget as the client project: a jsdom file's first render can take seconds while the
    // whole workspace gate runs.
    testTimeout: 30_000,
  },
})
