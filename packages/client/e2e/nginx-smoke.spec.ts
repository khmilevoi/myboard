import { expect, test } from '@playwright/test'

import { BoardPage } from './pages/BoardPage.js'
import { HeaderPage } from './pages/HeaderPage.js'
import { seedSession } from './support/gate.js'

test('nginx serves remote entries as JavaScript and never falls back for a missing remote', async ({
  request,
}) => {
  // все действия и экшены лучше хранить на уровне хендлеров, чтобы переюзать логику
  await seedSession(request)

  const remote = await request.get('/widgets/clock/remoteEntry.js')
  expect(remote.status()).toBe(200)
  expect(remote.headers()['content-type']).toContain('javascript')
  expect(remote.headers()['cache-control']).toContain('no-cache')
  expect(await remote.text()).not.toContain('<!doctype html>')

  const missing = await request.get('/widgets/missing/remoteEntry.js')
  expect(missing.status()).toBe(404)
  expect(await missing.text()).not.toContain('<div id="root">')
})

// The host's own entry is the one file whose URL is stable across releases
// while its contents change — it names the hashed chunk that calls
// createInstance. Without no-cache an intermediary keeps serving the previous
// release's copy, whose chunk 404s in the new one, and every loadRemote then
// fails with "#RUNTIME-009 Please call createInstance first": a board with no
// widgets at all. Cloudflare did exactly this on 2026-07-26 (cf-cache-status
// HIT, age 6503, against the default max-age=14400).
test('nginx marks the host federation entry no-cache so a stale edge copy cannot break init', async ({
  request,
}) => {
  await seedSession(request)

  const entry = await request.get('/remoteEntry.js')
  expect(entry.status()).toBe(200)
  expect(entry.headers()['content-type']).toContain('javascript')
  expect(entry.headers()['cache-control']).toContain('no-cache')

  // It must name a chunk this same release actually ships, or the host cannot
  // initialise — the failure mode the header exists to prevent.
  const chunk = /["']([^"']*virtual_mf-REMOTE_ENTRY_ID[^"']*\.js)["']/.exec(await entry.text())
  expect(chunk).not.toBeNull()
  const chunkResponse = await request.get(new URL(chunk![1], 'http://localhost/').pathname)
  expect(chunkResponse.status()).toBe(200)
})

// The service worker has the exact same hazard: vite-plugin-pwa emits it at the
// fixed name /sw.js, and its precache manifest changes every release. Cloudflare
// ignores the browser's forced-revalidation request directive, so without this
// header a deploy keeps serving the previous release's precached assets for hours.
test('nginx marks the service worker no-cache so a stale edge copy cannot pin clients to the old release', async ({
  request,
}) => {
  await seedSession(request)

  const sw = await request.get('/sw.js')
  expect(sw.status()).toBe(200)
  expect(sw.headers()['cache-control']).toContain('no-cache')
})

test('the production nginx image mounts Clock through the same-origin remote', async ({ page }) => {
  await seedSession(page.request)
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()

  await new HeaderPage(page).addWidget('Часы')

  const card = new BoardPage(page).getCard(0)
  await expect(card.getByText(/:/)).toBeVisible()
  //  заебал, че напрямую локатор в тесте ищется? сохрани ёпта
  await expect(card.locator('[class*="skeleton"]')).toHaveCount(0)
})

// The environment icons are referenced from BOTH the board and the activation
// page, and the activation page is the one surface an unauthenticated visitor
// sees. Under the catch-all `location /` these requests hit auth_request, get
// 401, and are answered with the activation HTML through error_page -- so the
// browser receives text/html for a favicon and the login screen stays
// unbranded, which is exactly the signal this feature exists to give.
test('nginx serves the environment icons without a session', async ({ request }) => {
  const icon = await request.get('/env/dev/favicon.svg')

  expect(icon.status()).toBe(200)
  expect(icon.headers()['content-type']).toContain('image/svg+xml')
  expect(await icon.text()).not.toContain('<div id="root">')

  const missing = await request.get('/env/nope/favicon.svg')
  expect(missing.status()).toBe(404)
})
