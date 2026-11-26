/**
 * Signs an agent into a non-production stand (board-dev / board-branch) with
 * a passkey of its own, no human in the loop, and leaves a Playwright storage
 * state behind for the agent's browser.
 *
 * The passkey lives in a CDP WebAuthn virtual authenticator -- the same one
 * the e2e suite uses -- and its private key is exported to the gitignored
 * `.auth/stand/<env>/` so the next run can sign in again without minting
 * another invite or another device. Cheapest path first:
 *
 *   1. the saved session cookie still passes `GET /api/auth/session`;
 *   2. the saved passkey signs in through `/activate` ("Войти с passkey");
 *   3. `rpi command create-invite --env <env>` mints a one-use invite and the
 *      virtual authenticator registers a new `agent` account on it.
 *
 * Usage: pnpm stand:login --env dev|branch [--fresh-invite] [--headed]
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'
import * as errore from 'errore'

import {
  AGENT_ACCOUNT_NAME,
  STAND_TARGETS,
  isVirtualCredential,
  parseInviteUrl,
  parseStandLoginArgs,
  standAuthPaths,
  type StandAuthPaths,
  type StandTarget,
  type VirtualCredential,
} from './model'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')

/**
 * `.auth/` sits in the main checkout, not in whichever worktree runs the
 * script: feature work happens in `.worktrees/<name>`, and a passkey kept
 * there would die with the worktree and leave every new one registering yet
 * another device on the stand.
 */
function resolveAuthRoot(): string {
  const result = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  const commonDir = result.status === 0 ? result.stdout.trim() : ''
  return commonDir === '' ? repoRoot : dirname(commonDir)
}

class StandLoginError extends errore.createTaggedError({
  name: 'StandLoginError',
  message: '$reason',
}) {}

type VirtualAuthenticator = {
  readonly page: Page
  send: <T>(method: string, params?: Record<string, unknown>) => Promise<T>
  authenticatorId: string
}

async function attachVirtualAuthenticator(page: Page): Promise<VirtualAuthenticator> {
  const client = await page.context().newCDPSession(page)
  const send = <T>(method: string, params?: Record<string, unknown>): Promise<T> =>
    // CDPSession.send is typed per protocol method; the WebAuthn domain is
    // driven generically here so the helper stays one small function.
    (client.send as (m: string, p?: Record<string, unknown>) => Promise<T>)(method, params)
  await send('WebAuthn.enable')
  const { authenticatorId } = await send<{ authenticatorId: string }>(
    'WebAuthn.addVirtualAuthenticator',
    {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        automaticPresenceSimulation: true,
        isUserVerified: true,
      },
    },
  )
  return { page, send, authenticatorId }
}

async function hasLiveSession(context: BrowserContext, target: StandTarget): Promise<boolean> {
  const response = await context.request.get(`${target.origin}/api/auth/session`, {
    failOnStatusCode: false,
  })
  return response.status() === 200
}

async function waitForBoard(page: Page, target: StandTarget): Promise<void> {
  await page.waitForURL((url) => url.origin === target.origin && url.pathname === '/', {
    timeout: 60_000,
  })
}

async function saveSession(
  context: BrowserContext,
  paths: StandAuthPaths,
  credential?: VirtualCredential,
): Promise<void> {
  await mkdir(paths.dir, { recursive: true })
  await context.storageState({ path: paths.storageState })
  if (credential !== undefined) {
    await writeFile(paths.credential, `${JSON.stringify(credential, null, 2)}\n`, 'utf8')
  }
}

async function readSavedCredential(paths: StandAuthPaths): Promise<VirtualCredential | undefined> {
  if (!existsSync(paths.credential)) return undefined
  const value = await errore.tryAsync(
    async () => JSON.parse(await readFile(paths.credential, 'utf8')) as unknown,
  )
  return isVirtualCredential(value) ? value : undefined
}

async function exportCredential(
  authenticator: VirtualAuthenticator,
): Promise<VirtualCredential | StandLoginError> {
  const { credentials } = await authenticator.send<{ credentials: unknown[] }>(
    'WebAuthn.getCredentials',
    { authenticatorId: authenticator.authenticatorId },
  )
  const credential = credentials.find(isVirtualCredential)
  if (credential === undefined) {
    return new StandLoginError({ reason: 'the virtual authenticator holds no credential' })
  }
  return credential
}

/** Step 1: the saved session cookie is still accepted. */
async function reuseSession(
  browser: Browser,
  target: StandTarget,
  paths: StandAuthPaths,
): Promise<boolean> {
  if (!existsSync(paths.storageState)) return false
  const context = await browser.newContext({ storageState: paths.storageState })
  try {
    return await hasLiveSession(context, target)
  } finally {
    await context.close()
  }
}

/** Step 2: sign in with the saved passkey. Returns false when the stand no longer knows it. */
async function signInWithSavedPasskey(
  browser: Browser,
  target: StandTarget,
  paths: StandAuthPaths,
  credential: VirtualCredential,
): Promise<boolean> {
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    const authenticator = await attachVirtualAuthenticator(page)
    await authenticator.send('WebAuthn.addCredential', {
      authenticatorId: authenticator.authenticatorId,
      credential,
    })
    await page.goto(`${target.origin}/activate`)
    await page.getByRole('button', { name: /Войти с passkey/ }).click()
    const reachedBoard = await errore.tryAsync(() => waitForBoard(page, target))
    if (reachedBoard instanceof Error || !(await hasLiveSession(context, target))) return false

    const refreshed = await exportCredential(authenticator)
    await saveSession(context, paths, refreshed instanceof Error ? credential : refreshed)
    return true
  } finally {
    await context.close()
  }
}

function mintInvite(target: StandTarget): string | StandLoginError {
  // rpi ships as rpi.cmd on Windows, which spawn only resolves through a
  // shell; every word here is a constant, so one command string is safe.
  const command = `rpi command create-invite --env ${target.rpiEnv} -- --label agent --ttl 15m`
  const result = spawnSync(command, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: true,
    timeout: 180_000,
  })
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  if (result.error !== undefined || result.status !== 0) {
    return new StandLoginError({
      reason: `rpi command create-invite --env ${target.rpiEnv} failed (${result.error?.message ?? `exit ${result.status}`}). Is rpi on PATH?\n${output.trim()}`,
    })
  }
  const url = parseInviteUrl(output, target.origin)
  if (url instanceof Error) {
    return new StandLoginError({ reason: `${url.message}\n${output.trim()}` })
  }
  return url
}

/** Step 3: register a new `agent` account on a fresh one-use invite. */
async function registerFromInvite(
  browser: Browser,
  target: StandTarget,
  paths: StandAuthPaths,
): Promise<void | StandLoginError> {
  const inviteUrl = mintInvite(target)
  if (inviteUrl instanceof Error) return inviteUrl

  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    const authenticator = await attachVirtualAuthenticator(page)
    await page.goto(inviteUrl)
    // locator.fill() hangs on this page while a CDP WebAuthn session is
    // attached (see e2e/pages/ActivatePage.ts); real keystrokes do not.
    const name = page.getByLabel('Ваше имя')
    await name.click()
    await name.pressSequentially(AGENT_ACCOUNT_NAME)
    await page.getByRole('button', { name: /Создать passkey/ }).click()

    const reachedBoard = await errore.tryAsync(() => waitForBoard(page, target))
    if (reachedBoard instanceof Error) {
      return new StandLoginError({
        reason: `registration never reached the board: ${reachedBoard.message}`,
      })
    }
    if (!(await hasLiveSession(context, target))) {
      return new StandLoginError({ reason: 'registered, but the stand rejects the new session' })
    }

    const credential = await exportCredential(authenticator)
    if (credential instanceof Error) return credential
    await saveSession(context, paths, credential)
  } finally {
    await context.close()
  }
}

async function signIn(
  browser: Browser,
  target: StandTarget,
  paths: StandAuthPaths,
  freshInvite: boolean,
): Promise<string | Error> {
  if (!freshInvite) {
    if (await reuseSession(browser, target, paths)) return 'session still valid'

    const credential = await readSavedCredential(paths)
    if (credential !== undefined) {
      if (await signInWithSavedPasskey(browser, target, paths, credential)) {
        return 'signed in with the saved passkey'
      }
      console.error('the saved passkey was rejected (stand reset?); minting a new invite')
    }
  }

  const registered = await registerFromInvite(browser, target, paths)
  if (registered instanceof Error) return registered
  return 'registered a new agent passkey from a fresh invite'
}

async function main(argv: readonly string[]): Promise<number> {
  const args = parseStandLoginArgs(argv)
  if (args instanceof Error) {
    console.error(`stand-login: ${args.message}`)
    return 2
  }

  const target = STAND_TARGETS[args.stand]
  const paths = standAuthPaths(resolveAuthRoot(), args.stand)
  const browser = await chromium.launch({ headless: !args.headed })
  const outcome = await errore.tryAsync(() => signIn(browser, target, paths, args.freshInvite))
  await browser.close()

  if (outcome instanceof Error) {
    console.error(`stand-login: ${outcome.message}`)
    return 1
  }
  console.log(`stand-login: ${outcome} on ${target.origin}`)
  console.log(`storage state: ${paths.storageState}`)
  return 0
}

process.exitCode = await main(process.argv.slice(2))
