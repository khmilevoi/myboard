import { expect, test } from '@playwright/test'

import { AccountMenuPage } from './pages/AccountMenuPage.js'

// The seeded account's name (POST /api/test/seed-session).
const SEEDED_NAME = 'E2E'

// An 8x6 RGB PNG. The browser decodes it, crops the square chosen in the crop dialog and
// re-encodes it as WebP before upload (prepareImage's avatar preset), so the stored blob is
// image/webp.
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

const FIXTURE = { name: 'me.png', mimeType: 'image/png', buffer: FIXTURE_PNG }

test('crops an avatar picked from the menu badge, shows it, and serves it only with a session', async ({
  page,
  request,
}) => {
  await page.goto('/')
  const menu = new AccountMenuPage(page, SEEDED_NAME)
  await expect(menu.trigger).toBeVisible()
  await expect(menu.triggerImage).toHaveCount(0)

  await menu.pickAvatarFromBadge(FIXTURE)
  // The menu gave way to the crop dialog.
  await expect(menu.profileItem).toHaveCount(0)
  await expect(menu.cropDialog.getByText('E2E отметил(а) уборку')).toBeVisible()

  // Zoom in from the slider, drag the photo, then nudge it from the keyboard.
  const zoom = menu.cropDialog.getByRole('slider', { name: 'Масштаб' })
  await zoom.fill('2')
  await expect(zoom).toHaveValue('2')
  const image = menu.cropStage.getByTestId('avatar-crop-image')
  const before = await image.getAttribute('style')
  const box = await menu.cropStage.boundingBox()
  if (!box) throw new Error('the crop stage has no layout box')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 20, { steps: 4 })
  await page.mouse.up()
  await expect.poll(() => image.getAttribute('style')).not.toBe(before)
  await menu.cropStage.focus()
  await page.keyboard.press('Shift+ArrowLeft')

  await menu.cropSave.click()
  await menu.cropDialog.waitFor({ state: 'detached' })

  await expect(menu.triggerImage).toBeVisible()
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

test('removes the avatar from the profile and falls back to initials', async ({ page }) => {
  await page.goto('/')
  const menu = new AccountMenuPage(page, SEEDED_NAME)
  await menu.uploadAvatar(FIXTURE)
  await expect(menu.triggerImage).toBeVisible()
  const url = await menu.triggerImageUrl()

  await menu.openProfile()
  await expect(menu.profileAvatar).toHaveAttribute('src', url)
  await menu.profileRemovePhoto.click()
  await expect(menu.profileAvatar).toHaveCount(0)
  await expect(menu.profileDialog.getByRole('button', { name: 'Загрузить фото' })).toBeVisible()
  await menu.closeProfile()

  await expect(menu.triggerImage).toHaveCount(0)
  await expect(menu.trigger).toHaveText('E2')
  // The old blob is deleted with the swap.
  expect((await page.request.get(url)).status()).toBe(404)
})

test('changes the photo from the profile; the crop opens over it and the profile stays', async ({
  page,
}) => {
  await page.goto('/')
  const menu = new AccountMenuPage(page, SEEDED_NAME)
  await menu.openProfile()

  const chooser = page.waitForEvent('filechooser')
  await menu.profileDialog.getByRole('button', { name: 'Загрузить фото' }).click()
  await (await chooser).setFiles(FIXTURE)
  await menu.cropDialog.waitFor()

  // Cancelling the crop leaves the profile underneath open.
  await menu.cropDialog.getByRole('button', { name: 'Отмена' }).click()
  await menu.cropDialog.waitFor({ state: 'detached' })
  await expect(menu.profileDialog).toBeVisible()

  const again = page.waitForEvent('filechooser')
  await menu.profileDialog.getByRole('button', { name: 'Загрузить фото' }).click()
  await (await again).setFiles(FIXTURE)
  await menu.cropSave.click()
  await menu.cropDialog.waitFor({ state: 'detached' })

  await expect(menu.profileAvatar).toBeVisible()
  await expect(menu.profileDialog).toBeVisible()
  await menu.closeProfile()
  await expect(menu.triggerImage).toBeVisible()
})

test('an unreadable file opens the crop dialog with its error and no stage', async ({ page }) => {
  await page.goto('/')
  const menu = new AccountMenuPage(page, SEEDED_NAME)

  await menu.pickAvatarFromBadge({
    name: 'me.png',
    mimeType: 'image/png',
    buffer: Buffer.from('definitely not a png'),
  })

  await expect(menu.cropError).toHaveText(
    'Не получилось прочитать файл. Выберите фото в JPEG, PNG или WebP.',
  )
  await expect(menu.cropStage).toHaveCount(0)
  await expect(menu.cropSave).toHaveCount(0)
  await expect(menu.cropDialog.getByRole('button', { name: 'Выбрать другой файл' })).toBeVisible()

  await menu.cropDialog.getByRole('button', { name: 'Отмена' }).click()
  await menu.cropDialog.waitFor({ state: 'detached' })
  await expect(menu.triggerImage).toHaveCount(0)
})

test('the devices dialog opens over the profile and its close button returns to the profile', async ({
  page,
}) => {
  await page.goto('/')
  const menu = new AccountMenuPage(page, SEEDED_NAME)
  await menu.openProfile()

  await menu.profileDialog.getByTestId('profile-open-devices').click()
  const devices = page.getByTestId('my-devices-dialog')
  await devices.waitFor()
  await expect(menu.profileDialog).toBeVisible()

  await devices.getByRole('button', { name: 'Закрыть' }).click()
  await devices.waitFor({ state: 'detached' })
  // Only the top dialog closed: the profile is still there.
  await expect(menu.profileDialog).toBeVisible()
  await menu.closeProfile()
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('the profile keeps the devices row compact: one line each, no squeezed text', async ({
    page,
  }) => {
    await page.goto('/')
    const menu = new AccountMenuPage(page, SEEDED_NAME)
    await menu.openProfile()

    const row = menu.profileDialog.getByTestId('profile-open-devices')
    const summary = row.getByTestId('profile-device-summary')
    const summaryBox = await summary.boundingBox()
    const rowBox = await row.boundingBox()
    if (!summaryBox || !rowBox) throw new Error('the devices row has no layout box')
    // A single 14px line, not the four-line wrap a separate text button used to force.
    expect(summaryBox.height).toBeLessThan(24)
    expect(rowBox.height).toBeLessThan(72)
  })
})
