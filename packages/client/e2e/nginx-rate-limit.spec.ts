import { expect, test } from '@playwright/test'

// Runs in its own project AFTER everything else (see
// playwright.nginx.config.ts): the burst drains the shared per-IP limit_req
// budget for ~60 s and would otherwise starve any spec running after it.
test('auth endpoints are rate limited', async ({ request }) => {
  const responses = await Promise.all(
    Array.from({ length: 50 }, () => request.get('/api/auth/session')),
  )
  const statuses = responses.map((r) => r.status())
  // Only assert throttling kicked in: earlier tests share this IP's budget,
  // so whether any of the 50 still reach the server (401) is timing-dependent.
  expect(statuses).toContain(429)
})
