import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
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
      env: { PORT: '8787' },
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter widgets-clock build && pnpm --filter widgets-clock preview',
      url: 'http://localhost:5180/widgets/clock/remoteEntry.js',
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
    },
    {
      command:
        'pnpm --filter widgets-ofelia-poop-duty build && pnpm --filter widgets-ofelia-poop-duty preview',
      url: 'http://localhost:5181/widgets/ofelia-poop-duty/remoteEntry.js',
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
    },
    {
      command: 'pnpm -w run codegen && npm run build && npm run preview',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env['CI'],
      timeout: 180_000,
    },
  ],
})
