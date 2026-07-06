import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  testIgnore: 'nginx-smoke.spec.ts',
  outputDir: 'test-results',
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
