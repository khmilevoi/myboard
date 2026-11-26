import { expect, test } from '@playwright/test'

import { AccountMenuPage } from './pages/AccountMenuPage.js'

// The seeded account's name (POST /api/test/seed-session).
const SEEDED_NAME = 'E2E'

// An 8x6 RGB PNG. The browser decodes it, crops the centred square and re-encodes it as WebP
// before upload (prepareImage's avatar preset), so the stored blob is image/webp.
const FIXTURE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAYElEQVR4nBXMMRVEIQwAwSihRgQiUqNklFBHBCJSo+j+bTvvbUQYYYUdhBNueCFiGtOa9mQ6053e/CCNtNJO0kk3vfyAwWL7d7i87xpllFV2UU655dUHbbTVdtNOu+21H11/PPF87Or0AAAAAElFTkSuQmCC',
  'base64',
)

// No /api/test/reset here: the FLUSHDB is process-wide (see add-device.spec.ts). Each test seeds
// its own fresh account and session, so the tests are isolated by construction.
//
// This runs against the host/docker e2e stack, where /files/<blobId> is answered by the server's
// Node fallback (through the preview proxy) with the same session and per-blob checks nginx's
// auth_request applies in production.
test.beforeEach(async ({ page }) => {
  // page.request shares the browser context's cookie jar, so the seeded session signs the page in.
  const seeded = await page.request.post('/api/test/seed-session')
  expect(seeded.ok()).toBe(true)
})

test('uploads an avatar, shows it in the account menu, and serves it only with a session', async ({
  page,
  request,
}) => {
  await page.goto('/')
  const menu = new AccountMenuPage(page, SEEDED_NAME)
  await expect(menu.trigger).toBeVisible()
  await expect(menu.triggerImage).toHaveCount(0)

  await menu.uploadAvatar({ name: 'me.png', mimeType: 'image/png', buffer: FIXTURE_PNG })

  await expect(menu.triggerImage).toBeVisible()
  await expect(menu.avatarError).toHaveCount(0)
  const url = await menu.triggerImageUrl()
  expect(url).toMatch(/^\/files\/[A-Za-z0-9_-]{16,64}$/)

  const withSession = await page.request.get(url)
  expect(withSession.status()).toBe(200)
  expect(withSession.headers()['content-type']).toBe('image/webp')
  expect(withSession.headers()['x-content-type-options']).toBe('nosniff')
  expect(withSession.headers()['cache-control']).toContain('private')

  // The `request` fixture is its own context with an empty cookie jar.
  const withoutSession = await request.get(url)
  expect(withoutSession.status()).toBe(401)

  // A reload reads the avatar back from /api/auth/account.
  await page.reload()
  await expect(menu.triggerImage).toHaveAttribute('src', url)
})

test('removes the avatar and falls back to initials', async ({ page }) => {
  await page.goto('/')
  const menu = new AccountMenuPage(page, SEEDED_NAME)
  await menu.uploadAvatar({ name: 'me.png', mimeType: 'image/png', buffer: FIXTURE_PNG })
  await expect(menu.triggerImage).toBeVisible()
  const url = await menu.triggerImageUrl()

  // The menu stays open after the upload; the remove item is there once the account has a photo.
  await menu.removeAvatarItem.click()

  await expect(menu.triggerImage).toHaveCount(0)
  await expect(menu.trigger).toHaveText('E2')
  await expect(menu.removeAvatarItem).toHaveCount(0)
  // The old blob is deleted with the swap.
  expect((await page.request.get(url)).status()).toBe(404)
})
