import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results/nginx',
  // Serial: all specs share one origin, one Valkey, and one per-IP
  // limit_req budget.
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:8080',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'nginx-chromium',
      testMatch: ['nginx-smoke.spec.ts', 'nginx-gate.spec.ts'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // The burst test drains the shared per-IP limit_req budget for ~60 s.
      // Playwright runs files alphabetically, so ordering "by comment" would
      // put it BEFORE nginx-smoke; a dependent project pins it last by
      // runner mechanics, not convention.
      name: 'nginx-rate-limit',
      testMatch: 'nginx-rate-limit.spec.ts',
      dependencies: ['nginx-chromium'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
