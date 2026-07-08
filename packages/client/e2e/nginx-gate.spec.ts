import { expect, test } from '@playwright/test'

import { ActivatePage } from './pages/ActivatePage.js'
import {
  expireSessions,
  revokeDeviceViaGate,
  seedInviteViaGate,
  seedSession,
} from './support/gate.js'
import { enableVirtualAuthenticator } from './support/webauthn.js'

test.describe('gate: no session', () => {
  test('a navigation gets the activation page with status 401', async ({ request }) => {
    const res = await request.get('/')
    expect(res.status()).toBe(401)
    expect(await res.text()).toContain('активация')
  })

  test('board statics are blocked without the activation fallback', async ({ request }) => {
    for (const path of [
      '/assets/anything.js',
      '/widgets/clock/remoteEntry.js',
      '/widgets/x/y.js',
    ]) {
      const res = await request.get(path)
      expect(res.status(), path).toBe(401)
      expect(await res.text(), path).not.toContain('активация')
    }
  })

  test('the storage and widget APIs are blocked', async ({ request }) => {
    expect((await request.get('/api/storage?prefix=')).status()).toBe(401)
    expect(
      (
        await request.post('/api/widgets/clock/echo', {
          headers: { 'X-Requested-With': 'MyBoard' },
          data: { instanceId: 'i', payload: {} },
        })
      ).status(),
    ).toBe(401)
  })

  test('the auth allowlist is reachable', async ({ request }) => {
    const session = await request.get('/api/auth/session')
    expect(session.status()).toBe(401)
    expect(await session.json()).toEqual({ code: 'session_missing' })

    const activate = await request.get('/activate/')
    expect(activate.status()).toBe(200)
    expect(await activate.text()).toContain('активация')

    const addDevice = await request.get('/add-device')
    expect(addDevice.status()).toBe(200)
    expect(await addDevice.text()).toContain('активация')
  })
})

test.describe('gate: seeded session', () => {
  test('the board, statics, and APIs open up with a session cookie', async ({ request }) => {
    await seedSession(request)

    const shell = await request.get('/')
    expect(shell.status()).toBe(200)
    expect(await shell.text()).toContain('<div id="root">')

    expect((await request.get('/api/storage?prefix=')).status()).toBe(200)
    expect((await request.get('/api/time')).status()).toBe(200)
  })

  test('a session survives; revocation cuts access on the next request', async ({ request }) => {
    const seeded = await seedSession(request)
    expect((await request.get('/api/auth/session')).status()).toBe(200)

    await revokeDeviceViaGate(request, seeded.credentialId)

    expect((await request.get('/api/auth/session')).status()).toBe(401)
    expect((await request.get('/')).status()).toBe(401)
  })

  test('a mutating storage call without the CSRF header is 403 even with a session', async ({
    request,
  }) => {
    await seedSession(request)
    const noHeader = await request.put('/api/storage/e2e%3Acsrf', { data: { value: 1 } })
    expect(noHeader.status()).toBe(403)
    expect(await noHeader.json()).toEqual({ code: 'csrf_required' })

    const withHeader = await request.put('/api/storage/e2e%3Acsrf', {
      headers: { 'X-Requested-With': 'MyBoard' },
      data: { value: 1 },
    })
    expect(withHeader.ok()).toBe(true)
  })
})

// Task 13 appends the browser journeys here. The limit_req burst test lives
// in nginx-rate-limit.spec.ts — its own dependent Playwright project — so it
// can never poison this file's (or the smoke file's) auth budget.

const ACCOUNT_NAME = 'Гейт-аккаунт'

/**
 * Registers a brand-new account through the real invite -> activation ->
 * board flow (mirrors auth-activation.spec.ts / add-device.spec.ts's own
 * `registerAccountAndDeviceA`), against the gated nginx origin. Returns the
 * invite token so callers can re-exercise the now-spent-invite login path
 * the same way auth-activation.spec.ts does.
 */
async function activateToBoard(page: import('@playwright/test').Page): Promise<{ token: string }> {
  const { token } = await seedInviteViaGate(page.request)
  await enableVirtualAuthenticator(page)
  const activate = new ActivatePage(page)
  await activate.gotoActivate(token)
  await activate.fillName(ACCOUNT_NAME)
  await activate.submitRegister()
  await activate.waitForBoardRedirect()
  return { token }
}

test.describe('gate: browser journeys', () => {
  test('invite → activation → board → logout purge → passkey re-login', async ({ page }) => {
    const { token } = await activateToBoard(page)

    // The board shell actually came through the gate.
    expect(new URL(page.url()).pathname).toBe('/')
    await page.reload()
    expect((await page.request.get('/api/auth/session')).status()).toBe(200)

    // Logout through the account menu -- same avatar-trigger/menuitem
    // selectors add-device.spec.ts's AccountMenuPage uses (the trigger's
    // aria-label is the account's registered name, not its initials; see
    // AccountMenu.tsx).
    await page.getByRole('button', { name: ACCOUNT_NAME }).click()
    await page.getByRole('menuitem', { name: 'Выйти' }).click()

    // Logout navigates to '/'; with the session gone, nginx serves the
    // activation fallback there (the visible heading text is 'Активируйте
    // устройство' or 'С возвращением' depending on mode -- 'активация' only
    // ever appears in the document <title>, never in on-page body text).
    // A follow-up reload is what a real re-opened tab would do too, and it
    // sidesteps the just-unregistered-but-not-yet-inert SW still answering
    // this exact navigation from its precache.
    await page.waitForURL('/')
    expect((await page.request.get('/api/auth/session')).status()).toBe(401)
    await page.reload()
    await expect(page).toHaveTitle(/активация/)

    // Local data purged: Dexie board data and every Cache Storage cache are
    // gone (purgeLocalSession never touches localStorage's non-secret
    // mb_cred_hint, so that alone surviving is expected, not a bug).
    expect(await page.evaluate(() => caches.keys())).toEqual([])
    const dbNames = await page.evaluate(() =>
      indexedDB.databases().then((dbs) => dbs.map((db) => db.name)),
    )
    expect(dbNames).not.toContain('myboard-storage')

    // Passkey re-login: re-submitting the now-spent invite token flips the
    // activation screen to its login mode (same 409 invite_consumed path
    // auth-activation.spec.ts's "second attempt" exercises), which is what
    // surfaces the "Войти с ключом доступа" button.
    const activate = new ActivatePage(page)
    await activate.gotoActivate(token)
    await activate.fillName('Гейт-аккаунт (повтор)')
    await activate.submitRegister()
    await expect(activate.signInButton).toBeVisible()
    await activate.submitLogin()
    await activate.waitForBoardRedirect()
    expect((await page.request.get('/api/auth/session')).status()).toBe(200)
  })

  // Both journeys below drive a real *server-backed* storage mutation via
  // the board-schema switcher ("Схемы борды": create/rename a named board),
  // not `HeaderPage.addWidget`. Two things ruled out placing a widget on the
  // default board:
  //  1. The default "Локальная" board (`LOCAL_BOARD_ID`) is wired to
  //     `rootStorage.client` only (see board-storage.ts) -- a deliberately
  //     Dexie-only, offline-first board that never calls the server at all,
  //     so there is no HTTP mutation for ensureSession's retry hook to ever
  //     intercept.
  //  2. Even switched to a real API-backed action, a *first-ever* mount of
  //     a widget also dynamically `import()`s its Module Federation remote
  //     under `/widgets/`, which sits behind the same nginx gate as the
  //     APIs -- but browser dynamic `import()` has no retry hook (only this
  //     app's HttpClient does, via makeUnauthorizedRetryHook in runtime.ts).
  //     A 401 there throws an uncaught "Failed to fetch dynamically
  //     imported module" and crashes the page before ensureSession ever
  //     runs. `BoardSchemaSelect`'s create/rename actions are core,
  //     already-bundled client code -- no federation fetch involved -- and
  //     `addBoard`/`updateBoard` (board-model.ts) write to the `boards` atom,
  //     which board-storage.ts wires to `rootStorage.server`: a genuine
  //     `http.put` through the shared, retry-hooked client every time.
  // `boards` (the server-backed named-schema list) is NOT scoped per account
  // server-side (packages/server has no accountId-prefixed storage
  // namespacing -- every account on this deployment shares one board
  // dataset, by design: this is a single-household app, and "accounts" are
  // just that household's different devices/members). That means a schema
  // name created by one test run can still be sitting in Valkey (and thus
  // auto-selected as the new active board on mount, via
  // selectInitialActiveBoard in board-storage.ts) the next time this suite
  // runs against the same, not-yet-reset stack -- confirmed by observation
  // (a stale "Гейт-схема 2" from an earlier local run was already the active
  // board on a brand new account, so the initial "Текущая схема: Локальная"
  // trigger never existed for that run). A per-invocation-unique name plus a
  // run-independent trigger locator (matching "Текущая схема:" regardless of
  // *which* board it currently names) make each journey robust to that.
  function uniqueSchemaName(): string {
    return `Гейт-схема-${Date.now()}`
  }
  const schemaTrigger = (page: import('@playwright/test').Page) =>
    page.getByRole('button', { name: /^Текущая схема:/ })

  async function createNamedSchema(
    page: import('@playwright/test').Page,
    name: string,
  ): Promise<void> {
    await schemaTrigger(page).click()
    await page.getByLabel('Название новой схемы').fill(name)
    await page.getByRole('button', { name: 'Добавить схему' }).click()
    await page.getByRole('button', { name, exact: true }).click()
    await expect(page.getByRole('button', { name: `Текущая схема: ${name}` })).toBeVisible()
  }

  test('an expired session re-logs in silently on a storage call', async ({ page }) => {
    // Every /api/auth/* call (including plain session checks) shares one
    // nginx `auth_zone` limit_req budget (30r/m, burst 15, nodelay) with
    // every earlier test in this file/project (single worker, one origin).
    // The previous journey alone spends most of that burst on its two
    // registrations + a login; without this pause this test's very first
    // register/options call gets a bare 429 (parsed client-side as "invalid
    // server response"), well before the dedicated nginx-rate-limit.spec.ts
    // project ever intentionally exercises 429s.
    test.slow()
    await page.waitForTimeout(45_000)

    const schemaName = uniqueSchemaName()
    await activateToBoard(page)
    await createNamedSchema(page, schemaName)

    await expireSessions(page.request)

    // The next storage mutation (renaming the schema) hits a 401,
    // ensureSession runs the ceremony against the virtual authenticator, and
    // the request is retried — all without a navigation.
    await schemaTrigger(page).click()
    await page.getByRole('button', { name: `Переименовать схему ${schemaName}` }).click()
    const renamed = `${schemaName} 2`
    await page.getByLabel(`Новое имя схемы ${schemaName}`).fill(renamed)
    await page.getByRole('button', { name: 'Сохранить имя схемы' }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: `Текущая схема: ${renamed}` })).toBeVisible()

    // The rename's optimistic UI update above lands slightly before the
    // recovered session cookie is actually swapped in (confirmed by
    // observation: the old, now-invalid `mb_session` value is still present
    // and /api/auth/session still 401 in the same tick the rename becomes
    // visible; a fresh `mb_session` + `mb_chal` land ~1-2s later once the
    // retried ceremony's response is fully processed) -- poll rather than
    // check once immediately.
    expect(new URL(page.url()).pathname).toBe('/')
    await expect
      .poll(async () => (await page.request.get('/api/auth/session')).status())
      .toBe(200)
  })

  test('a revoked device is bounced to the activation page', async ({ page }) => {
    // See the pacing comment on the previous test -- same shared auth_zone
    // budget.
    test.slow()
    await page.waitForTimeout(45_000)

    const schemaName = uniqueSchemaName()
    await activateToBoard(page)
    await createNamedSchema(page, schemaName)

    const credentialId = await page.evaluate(() => localStorage.getItem('mb_cred_hint'))
    expect(credentialId).toBeTruthy()
    await revokeDeviceViaGate(page.request, credentialId!)

    // Trigger a storage call: relogin's ceremony verifies against a deleted
    // device, login/verify rejects, and the model hard-navigates to
    // /activate/ — the SW-proof target (Task 8), always served by nginx.
    // These journeys run in fresh Playwright contexts where the installed
    // service worker is not yet controlling navigations, so this exercises
    // the same-origin nginx fallback rather than the SW's own
    // navigateFallbackDenylist (Task 8 Step 5 covers that separately).
    await schemaTrigger(page).click()
    await page.getByRole('button', { name: `Переименовать схему ${schemaName}` }).click()
    await page.getByLabel(`Новое имя схемы ${schemaName}`).fill(`${schemaName} 2`)
    await page.getByRole('button', { name: 'Сохранить имя схемы' }).click()

    await expect(page).toHaveURL(/\/activate\//)
    await expect(page).toHaveTitle(/активация/)
  })
})
