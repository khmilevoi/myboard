import fs from 'node:fs/promises'
import path from 'node:path'

import * as errore from 'errore'
import { chromium, type BrowserContext, type Page } from 'playwright'

import { BrowserTaskError } from '../errors'
import type { BrowserExecutor } from '../executor'
import { makeDetectUserInput } from '../user-input'
import { type BrowserTaskContext } from './context'
import { makeWidgetSecrets } from './secrets'

export type LaunchPersistentContext = (profileDir: string) => Promise<BrowserContext>

export class BrowserLaunchError extends errore.createTaggedError({
  name: 'BrowserLaunchError',
  message: 'Failed to launch Chromium persistent context',
  extends: BrowserTaskError,
}) {}

class BrowserAcquireAbortedError extends errore.createTaggedError({
  name: 'BrowserAcquireAbortedError',
  message: 'Chromium task acquire aborted',
  extends: errore.AbortError,
}) {}

class ProfileSingletonCleanupError extends errore.createTaggedError({
  name: 'ProfileSingletonCleanupError',
  message: 'Failed to remove $entry from the Chromium profile',
}) {}

// Chromium writes `<hostname>-<pid>` into SingletonLock to guard the profile.
// In Docker the profile lives on a named volume that outlives the container, so
// after a redeploy Chromium finds a lock owned by "another computer", cannot
// check whether that process is alive, and refuses to launch — every redeploy,
// not once.
const singletonEntryNames = ['SingletonLock', 'SingletonCookie', 'SingletonSocket']

// Removing them unconditionally is safe here: `getPersistentContext` below is
// the only caller of `launch` and keeps one context per process, and the image
// entrypoint runs a single `node dist/index.cjs`, so no second live Chromium
// can hold this profile directory. Nothing checks for a running Chromium.
async function removeStaleSingletonEntries(profileDir: string) {
  const removals = await Promise.all(
    singletonEntryNames.map((entry) =>
      fs
        // The entries are symlinks: `rm` unlinks the link itself instead of
        // following it, and `force` keeps a fresh profile from failing.
        .rm(path.join(profileDir, entry), { force: true })
        .then(() => null)
        .catch((cause: unknown) => new ProfileSingletonCleanupError({ entry, cause })),
    ),
  )
  return removals.find((removal) => removal instanceof Error) ?? null
}

type ManagedBrowserTaskContext = BrowserTaskContext & {
  abortListener: () => void
  released: boolean
  retained: boolean
  signal: AbortSignal
  widgetId: string
}

// Serialized into Chromium by context.addInitScript, so the browser global
// exists at runtime; declaring it module-locally keeps the DOM lib out of
// this Node-only package's tsconfig (same reasoning as the declares atop
// user-input/cloudflare.ts).
declare const navigator: { webdriver?: boolean }

// Cloudflare Turnstile (the challenge cloudflare.ts detects) treats
// navigator.webdriver as a bot signal even while a real human is driving the
// page through the noVNC recovery view: the page stays a Playwright-owned CDP
// target the whole time, human clicks included. Hiding the cheapest of those
// signals — plus the launch flag below — is what lets a genuine human click
// actually clear the challenge instead of being silently rejected.
function hideWebdriverFlag() {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
}

async function launchPersistentChromium(profileDir: string) {
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    args: ['--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'],
  })
  await context.addInitScript(hideWebdriverFlag)
  return context
}

async function closePage(page: Page) {
  const result = await page.close().catch((cause: unknown) => cause as Error)
  if (result instanceof Error) console.warn('Failed to close Chromium page', result)
}

async function closeBrowserContext(context: BrowserContext) {
  const result = await context.close().catch((cause: unknown) => cause as Error)
  if (result instanceof Error) {
    console.warn('Failed to close Chromium persistent context', result)
  }
}

function toAbortError(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new BrowserAcquireAbortedError({ cause: signal.reason })
}

export function makeChromiumExecutor(deps: {
  profileDir: string
  secretsDir: string
  /** Public SSH fallback hint put into escalation error meta. */
  recoverySshTarget?: string | null
  /** Public noVNC host port hint put into escalation error meta. */
  novncPort?: number
  launch?: LaunchPersistentContext
}): BrowserExecutor<BrowserTaskContext> {
  const launch = deps.launch ?? launchPersistentChromium
  let persistentContext: BrowserContext | null = null
  let launching: Promise<BrowserContext> | null = null
  let shutdownPromise: Promise<void> | null = null
  let activeTaskCount = 0
  let inFlightAcquireCount = 0
  const retainedPages = new Map<string, Page>()

  const resetPersistentContext = () => {
    persistentContext = null
    launching = null
    shutdownPromise = null
    retainedPages.clear()
  }

  async function closeRetainedPage(widgetId: string) {
    const page = retainedPages.get(widgetId)
    if (!page) return
    retainedPages.delete(widgetId)
    await closePage(page)
  }

  async function launchWithCleanProfile() {
    const cleanup = await removeStaleSingletonEntries(deps.profileDir)
    if (cleanup instanceof Error) {
      console.warn('Failed to remove stale Chromium singleton entries', cleanup)
    }
    return launch(deps.profileDir)
  }

  async function getPersistentContext() {
    if (persistentContext) return persistentContext
    if (launching) return launching

    launching = launchWithCleanProfile()
      .then((context) => {
        persistentContext = context
        launching = null
        context.on('close', () => {
          if (persistentContext === context) resetPersistentContext()
        })
        return context
      })
      .catch((cause) => {
        resetPersistentContext()
        throw new BrowserLaunchError({ cause })
      })

    return launching
  }

  async function releaseManagedContext(context: ManagedBrowserTaskContext) {
    if (context.released) return
    context.released = true
    activeTaskCount -= 1
    context.signal.removeEventListener('abort', context.abortListener)
    if (context.retained && !context.signal.aborted) {
      const previous = retainedPages.get(context.widgetId)
      retainedPages.set(context.widgetId, context.page)
      if (previous && previous !== context.page) await closePage(previous)
      return
    }
    await closePage(context.page)
  }

  async function closeUnclaimedPersistentContext(context: BrowserContext) {
    if (persistentContext !== context) return
    if (activeTaskCount > 0) return
    if (inFlightAcquireCount > 1) return
    if (shutdownPromise) return
    await closeBrowserContext(context)
  }

  return {
    async acquire(signal, widgetId) {
      inFlightAcquireCount += 1
      try {
        if (signal.aborted) return toAbortError(signal)

        const waitsForInitialLaunch = persistentContext === null
        const context = await getPersistentContext().catch((error) => error as Error)
        if (context instanceof Error) return context
        if (signal.aborted) {
          if (waitsForInitialLaunch) await closeUnclaimedPersistentContext(context)
          return toAbortError(signal)
        }
        await closeRetainedPage(widgetId)
        if (signal.aborted) return toAbortError(signal)

        const page = await context
          .newPage()
          .catch((cause: unknown) =>
            signal.aborted ? toAbortError(signal) : new BrowserLaunchError({ cause }),
          )
        if (page instanceof Error) return page

        const managedContext: ManagedBrowserTaskContext = {
          abortListener: () => {
            void releaseManagedContext(managedContext)
          },
          released: false,
          retained: false,
          page,
          secrets: makeWidgetSecrets(widgetId, deps.secretsDir),
          signal,
          widgetId,
          detectUserInput: makeDetectUserInput({
            page,
            recoverySshTarget: deps.recoverySshTarget ?? null,
            novncPort: deps.novncPort,
            retain: () => {
              managedContext.retained = true
            },
          }),
        }

        activeTaskCount += 1
        signal.addEventListener('abort', managedContext.abortListener, { once: true })
        if (signal.aborted) {
          await releaseManagedContext(managedContext)
          return toAbortError(signal)
        }

        return managedContext
      } finally {
        inFlightAcquireCount -= 1
      }
    },
    async release(context) {
      await releaseManagedContext(context as ManagedBrowserTaskContext)
    },
    hasRetainedPage(widgetId) {
      const page = retainedPages.get(widgetId)
      if (!page) return false
      if (page.isClosed()) {
        retainedPages.delete(widgetId)
        return false
      }
      return true
    },
    async shutdown() {
      if (shutdownPromise) return shutdownPromise
      if (!persistentContext && !launching) return

      const launchInFlight = launching
      const shutdown = (async () => {
        const context =
          persistentContext ?? (launchInFlight ? await launchInFlight.catch(() => null) : null)
        if (!context) return
        await closeBrowserContext(context)
      })()
      const trackedShutdown = shutdown.finally(() => {
        if (shutdownPromise === trackedShutdown) shutdownPromise = null
      })
      shutdownPromise = trackedShutdown
      return trackedShutdown
    },
  }
}
