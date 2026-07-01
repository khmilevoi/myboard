import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  testMatch: 'nginx-smoke.spec.ts',
  outputDir: 'test-results/nginx',
  use: {
    baseURL: 'http://127.0.0.1:8080',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'nginx-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
