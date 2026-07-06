import { expect, test } from '@playwright/test'

import { ActivatePage } from './pages/ActivatePage.js'
import { seedInvite } from './support/seed.js'
import { enableVirtualAuthenticator } from './support/webauthn.js'

test('invite activation registers a passkey, reaches the board, and survives reload', async ({
  page,
  request,
}) => {
  const { token } = await seedInvite(request)
  await enableVirtualAuthenticator(page)

  const activate = new ActivatePage(page)
  await activate.gotoActivate(token)
  await activate.fillName('Test Account')
  await activate.submitRegister()

  // Registration succeeded and the app navigated back to the board root.
  await activate.waitForBoardRedirect()
  expect(new URL(page.url()).pathname).toBe('/')
  const boardRoot = await page.request.get('/')
  expect(boardRoot.status()).toBe(200)
  expect(await boardRoot.text()).not.toContain('myboard — активация')

  const sessionBeforeReload = await page.request.get('/api/auth/session')
  expect(sessionBeforeReload.status()).toBe(200)
  const { accountId } = (await sessionBeforeReload.json()) as { accountId: string }
  expect(accountId).toBeTruthy()

  // Reload: the session cookie alone must keep the account authorized, with
  // no re-registration and no bounce back to the activation screen.
  await page.reload()
  expect(new URL(page.url()).pathname).toBe('/')

  const sessionAfterReload = await page.request.get('/api/auth/session')
  expect(sessionAfterReload.status()).toBe(200)
  expect((await sessionAfterReload.json()) as { accountId: string }).toEqual({ accountId })

  const logout = await page.request.post('/api/auth/logout', {
    headers: { 'X-Requested-With': 'MyBoard' },
  })
  expect(logout.status()).toBe(204)

  const sessionAfterLogout = await page.request.get('/api/auth/session')
  expect(sessionAfterLogout.status()).toBe(401)

  // Re-activating with the now-spent invite token must not allow a second
  // registration: the register/options call reports the invite as consumed.
  const spentOptions = await page.request.post('/api/auth/register/options', {
    data: { token },
  })
  expect(spentOptions.status()).toBe(409)
  expect(await spentOptions.json()).toEqual({ code: 'invite_consumed', canLogin: true })

  // The activation screen reflects the same spent-invite state by falling
  // back to the login affordance instead of the registration form.
  await activate.gotoActivate(token)
  await activate.fillName('Second Attempt')
  await activate.submitRegister()

  await expect(activate.signInButton).toBeVisible()
  await expect(activate.createPasskeyButton).toHaveCount(0)
})
