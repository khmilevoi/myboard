import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  testIgnore: 'nginx-smoke.spec.ts',
  outputDir: 'test-results',
  // All spec files share ONE test-server process (started once below, for
  // the whole run) backed by ONE Valkey instance -- the process-wide test
  // clock (`/api/test/time`, used by ofelia-duty.spec.ts) and the full
  // FLUSHDB (`/api/test/reset`, used by ofelia-duty.spec.ts and this file)
  // are therefore global mutable state, not per-worker. Playwright's default
  // worker count (~half the CPUs) runs multiple spec files concurrently
  // against that same shared state, so one file's reset()/clock-pin can
  // silently corrupt another file's in-flight test (observed: a concurrently
  // running ofelia-duty.spec.ts reset() wiped an add-device.spec.ts test's
  // freshly-registered account mid-flight, surfacing as a bogus "session
  // expired"). Forcing a single worker under CI (where this whole suite is
  // meant to run self-contained and deterministic, see `pnpm
  // test:e2e:docker`) serializes every test against that shared state and
  // removes this whole class of cross-file collision; local ad-hoc runs
  // (no CI env) keep the default parallelism.
  workers: process.env['CI'] ? 1 : undefined,
  use: {
    baseURL: 'http://localhost:4173',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter server build && node ../server/dist/test-server.cjs',
      url: 'http://localhost:8787/api/time',
      env: {
        PORT: '8787',
        RP_ID: 'localhost',
        RP_NAME: 'MyBoard',
        EXPECTED_ORIGIN: 'http://localhost:4173',
        PUBLIC_APP_URL: 'http://localhost:4173',
      },
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
    },
    {
      command: 'pnpm -w build && npm run preview',
      url: 'http://localhost:4173/widgets/clock/remoteEntry.js',
      reuseExistingServer: !process.env['CI'],
      timeout: 240_000,
    },
  ],
})
