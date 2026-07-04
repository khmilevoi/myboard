import * as errore from 'errore'
import { chromium, type BrowserContext, type Page } from 'playwright'

import { BrowserTaskError } from '../errors'
import type { BrowserExecutor } from '../executor'
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

type ManagedBrowserTaskContext = BrowserTaskContext & {
  abortListener: () => void
  released: boolean
  signal: AbortSignal
}

async function launchPersistentChromium(profileDir: string) {
  return chromium.launchPersistentContext(profileDir, {
    headless: false,
    args: ['--disable-dev-shm-usage'],
  })
}

async function closePage(page: Page) {
  const result = await page.close().catch((cause) => cause as Error)
  if (result instanceof Error) console.warn('Failed to close Chromium page', result)
}

async function closeBrowserContext(context: BrowserContext) {
  const result = await context.close().catch((cause) => cause as Error)
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
  launch?: LaunchPersistentContext
}): BrowserExecutor<BrowserTaskContext> {
  const launch = deps.launch ?? launchPersistentChromium
  let persistentContext: BrowserContext | null = null
  let launching: Promise<BrowserContext> | null = null
  let shutdownPromise: Promise<void> | null = null
  let activeTaskCount = 0
  let inFlightAcquireCount = 0

  const resetPersistentContext = () => {
    persistentContext = null
    launching = null
    shutdownPromise = null
  }

  async function getPersistentContext() {
    if (persistentContext) return persistentContext
    if (launching) return launching

    launching = launch(deps.profileDir)
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

        const page = await context
          .newPage()
          .catch((cause) =>
            signal.aborted ? toAbortError(signal) : new BrowserLaunchError({ cause }),
          )
        if (page instanceof Error) return page

        const managedContext: ManagedBrowserTaskContext = {
          abortListener: () => {
            void releaseManagedContext(managedContext)
          },
          released: false,
          page,
          secrets: makeWidgetSecrets(widgetId, deps.secretsDir),
          signal,
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
