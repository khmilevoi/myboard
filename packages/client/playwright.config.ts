import { availableParallelism } from 'node:os'

import { defineConfig, devices } from '@playwright/test'

// Every worker brings up its own app stack — test-server, Valkey database and
// preview origin — through the worker-scoped `stack` fixture in
// e2e/support/test.ts, so `/api/test/reset` and `/api/test/time` only ever
// touch the calling worker. Specs therefore run in parallel safely; there is
// no shared `webServer`. Each worker costs a Chromium, a Node server and a
// Vite preview, so the default stays at half the cores (E2E_WORKERS overrides).
const workers = Number(process.env['E2E_WORKERS'] ?? Math.max(1, availableParallelism() / 2))

export default defineConfig({
  testDir: 'e2e',
  testIgnore: ['nginx-smoke.spec.ts', 'nginx-gate.spec.ts', 'nginx-rate-limit.spec.ts'],
  outputDir: 'test-results',
  globalSetup: './e2e/support/global-setup.ts',
  workers,
  // A failure is a failure: no retries to hide flakiness, and a stray
  // `test.only` fails the run instead of silently skipping the suite.
  retries: 0,
  forbidOnly: !!process.env['CI'],
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    // No `trace`: recording one per test and zipping it at context teardown
    // into test-results — a bind mount from the Windows host under docker —
    // blew the 30 s teardown budget and left truncated zips. Turn it on for a
    // single local run with `--trace on` when a failure needs one.
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
