import { AccountMenuPage } from './pages/AccountMenuPage.js'
import { ActivatePage } from './pages/ActivatePage.js'
import { AddDeviceActivatePage } from './pages/AddDeviceActivatePage.js'
import { ADD_CODE_PATTERN, AddDeviceModalPage } from './pages/AddDeviceModalPage.js'
import { MyDevicesDialogPage } from './pages/MyDevicesDialogPage.js'
import { seedInvite } from './support/seed.js'
import { expect, test } from './support/test.js'
import { enableVirtualAuthenticator } from './support/webauthn.js'

const OWNER_NAME = 'Device A Owner'

// No `/api/test/reset` here: each test seeds its own fresh invite/account via
// `seedInvite`, so it is isolated by construction. (Workers cannot see each
// other's data anyway — every worker has its own stack, see support/stack.ts.)
//
// The "invalid code" negative below uses a never-minted rather than a
// clock-advanced, genuinely expired code, so the test needs no clock control.
// Server-side, lookupAddToken's `checkLive` maps an expired token and an
// unknown token to the exact same AddTokenInvalidError, so a never-minted
// code exercises the identical code path and client-side error handling.
const NEVER_MINTED_CODE = 'ZZZZZZZZ'

/**
 * Registers a brand-new account + device A on `page` via the real Plan 1
 * invite flow (seed an invite, activate, land on the board) -- mirrors
 * auth-activation.spec.ts's own happy path exactly.
 */
async function registerAccountAndDeviceA(
  page: import('./support/test.js').Page,
  request: import('./support/test.js').APIRequestContext,
): Promise<void> {
  const { token } = await seedInvite(request)
  await enableVirtualAuthenticator(page)

  const activate = new ActivatePage(page)
  await activate.gotoActivate(token)
  await activate.fillName(OWNER_NAME)
  await activate.submitRegister()
  await activate.waitForBoardRedirect()
}

/**
 * Drives device A's owner-side "Добавить устройство" flow from the board:
 * opens the account menu -> "Мои устройства" -> "Добавить устройство" ->
 * confirms identity (fresh UV via the page's own virtual authenticator) ->
 * returns the minted `AddDeviceModalPage` (left open, showing the code) plus
 * the code itself.
 */
async function mintAddDeviceCode(
  page: import('./support/test.js').Page,
): Promise<{ modal: AddDeviceModalPage; code: string }> {
  const accountMenu = new AccountMenuPage(page, OWNER_NAME)
  await accountMenu.openMyDevices()

  const myDevices = new MyDevicesDialogPage(page)
  await expect(myDevices.dialog).toBeVisible()
  await myDevices.openAddDevice()

  const modal = new AddDeviceModalPage(page)
  await modal.confirmIdentity()
  const formatted = await modal.readCode()
  expect(formatted).toMatch(ADD_CODE_PATTERN)

  return { modal, code: formatted.replace('-', '') }
}

test('device B registers via a minted code, owner approves over SSE, device B claims a session (no second ceremony)', async ({
  browser,
  request,
}) => {
  // Two full WebAuthn ceremonies, an SSE round-trip, and (up to) a couple of
  // the joining device's 2s poll ticks push this comfortably past the
  // default 30s test timeout under any real contention.
  test.slow()

  const contextA = await browser.newContext()
  const pageA = await contextA.newPage()
  await registerAccountAndDeviceA(pageA, request)

  const { modal, code } = await mintAddDeviceCode(pageA)

  // Device B: a wholly separate browser context (own cookies/storage) with
  // its own virtual authenticator, simulating a second, unrelated device.
  const contextB = await browser.newContext()
  const pageB = await contextB.newPage()

  // Record device B's POST paths so we can prove it obtains its session via
  // claim-session and never runs a second login ceremony (login/verify).
  const deviceBPosts: string[] = []
  pageB.on('request', (req) => {
    if (req.method() === 'POST') deviceBPosts.push(new URL(req.url()).pathname)
  })

  await enableVirtualAuthenticator(pageB)

  const addDeviceB = new AddDeviceActivatePage(pageB)
  // Open the activation link with the code already embedded: on mount the code
  // is auto-applied and server-validated (no manual typing), landing straight
  // on the "Создать passkey" step. The virtual authenticator can't run without
  // a real gesture, so the passkey button is the only remaining tap. Waiting
  // for that button (its label flips from the "Создаём passkey…" loading state)
  // also guarantees the background validation has finished before we click.
  await addDeviceB.gotoAddDevice(code)
  await addDeviceB.createPasskey()
  await expect(addDeviceB.waitingHeading).toBeVisible()

  // Device A's already-open "Добавить устройство" modal flips in place to
  // the approval card once the SSE `device-pending` event arrives.
  await modal.waitForPendingDevice()
  await modal.approve()
  await expect(modal.successHeading).toBeVisible()

  // Device B's poll (every 2s) picks up the approval, claims its session via
  // claim-session (no second ceremony), and lands on the board root -- no
  // manual sign-in on device B.
  await addDeviceB.waitForBoardRedirect()
  expect(new URL(pageB.url()).pathname).toBe('/')

  const sessionB = await pageB.request.get('/api/auth/session')
  expect(sessionB.status()).toBe(200)

  expect(deviceBPosts).toContain('/api/auth/devices/claim-session')
  expect(deviceBPosts).not.toContain('/api/auth/login/verify')

  await contextA.close()
  await contextB.close()
})

test('closing AddDeviceModal via its own X button leaves MyDevicesDialog open underneath', async ({
  browser,
  request,
}) => {
  // Regression test for a Radix DismissableLayer stacking race: these are
  // two sibling (not DOM-nested) Dialog.Root instances, and AddDeviceModal's
  // own close button used to also close MyDevicesDialog underneath it. See
  // MyDevicesDialog.tsx's onPointerDownOutside/onInteractOutside comment for
  // the mechanism. jsdom's fireEvent.click can't reproduce this -- it skips
  // the real pointerdown-then-click sequence the race depends on -- so this
  // needs a real browser.
  test.slow()

  const contextA = await browser.newContext()
  const pageA = await contextA.newPage()
  await registerAccountAndDeviceA(pageA, request)

  const { modal } = await mintAddDeviceCode(pageA)

  const myDevices = new MyDevicesDialogPage(pageA)
  await modal.close()

  await expect(modal.dialog).not.toBeVisible()
  await expect(myDevices.dialog).toBeVisible()
  await expect(myDevices.addDeviceButton).toBeVisible()

  await contextA.close()
})

test('an invalid add-device code shows an error instead of registering', async ({ browser }) => {
  test.slow()

  const contextB = await browser.newContext()
  const pageB = await contextB.newPage()
  await enableVirtualAuthenticator(pageB)

  const addDeviceB = new AddDeviceActivatePage(pageB)
  // Open a link carrying a bad code: it is auto-validated on mount and rejected
  // by the server, dropping straight to manual entry with an error -- the
  // passkey step is never reached, and no manual typing is needed to surface it.
  await addDeviceB.gotoAddDevice(NEVER_MINTED_CODE)

  await expect(addDeviceB.errorText).toBeVisible()
  await expect(addDeviceB.createPasskeyButton).toHaveCount(0)

  await contextB.close()
})

test('a denied device shows "Запрос отклонён" on the joining device', async ({
  browser,
  request,
}) => {
  test.slow()

  const contextA = await browser.newContext()
  const pageA = await contextA.newPage()
  await registerAccountAndDeviceA(pageA, request)

  const { modal, code } = await mintAddDeviceCode(pageA)

  const contextB = await browser.newContext()
  const pageB = await contextB.newPage()
  await enableVirtualAuthenticator(pageB)

  const addDeviceB = new AddDeviceActivatePage(pageB)
  // Manual-entry path (no code in the link): open the bare /add-device screen,
  // type the code and continue. "Продолжить" runs the ceremony inline via
  // submitManual, so this keeps coverage of hand-typed codes alongside the
  // auto-applied-link path exercised by the happy-path test above.
  await addDeviceB.gotoAddDevice()
  await addDeviceB.enterCode(code)
  await addDeviceB.submitCode()
  await expect(addDeviceB.waitingHeading).toBeVisible()

  await modal.waitForPendingDevice()
  await modal.deny()

  await expect(addDeviceB.rejectedHeading).toBeVisible({ timeout: 20_000 })
  expect(new URL(pageB.url()).pathname).toBe('/add-device')

  await contextA.close()
  await contextB.close()
})
