import { lstatSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import * as errore from 'errore'
import type { BrowserContext, Page } from 'playwright'
import { describe, expect, it, vi } from 'vitest'

import { UserInputProbeError, UserInputRequiredError, type UserInputDetector } from '../user-input'
import {
  BrowserLaunchError,
  makeChromiumExecutor,
  type LaunchPersistentContext,
} from './chromium-executor'

type FakePage = {
  closeCalls: number
  closed: boolean
  close: () => Promise<void>
  isClosed: () => boolean
}

type FakeContext = {
  closeCalls: number
  closed: boolean
  pages: FakePage[]
  emitClose: () => void
  newPage: () => Promise<FakePage>
  on: (event: string, cb: () => void) => FakeContext
  close: () => Promise<void>
}

function makeDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })
  return { promise, resolve, reject }
}

function makeFakeContext(options?: { newPage?: () => Promise<FakePage> }): FakeContext {
  const closeListeners: Array<() => void> = []

  const context: FakeContext = {
    closeCalls: 0,
    closed: false,
    pages: [],
    emitClose() {
      if (context.closed) return
      context.closed = true
      for (const listener of closeListeners) listener()
    },
    async newPage() {
      if (options?.newPage) return options.newPage()
      const page: FakePage = {
        closeCalls: 0,
        closed: false,
        async close() {
          page.closeCalls += 1
          if (page.closed) return
          page.closed = true
        },
        isClosed: () => page.closed,
      }
      context.pages.push(page)
      return page
    },
    on(event, cb) {
      if (event === 'close') closeListeners.push(cb)
      return context
    },
    async close() {
      context.closeCalls += 1
      await Promise.all(context.pages.map((page) => page.close()))
      context.emitClose()
    },
  }

  return context
}

function makeLaunch(created: FakeContext[]): LaunchPersistentContext {
  return async () => {
    const context = makeFakeContext()
    created.push(context)
    return context as unknown as BrowserContext
  }
}

const singletonEntryNames = ['SingletonLock', 'SingletonCookie', 'SingletonSocket']

function entryExists(entryPath: string) {
  // lstat, not exists: the entries Chromium leaves behind are symlinks whose
  // target never existed on this machine.
  return lstatSync(entryPath, { throwIfNoEntry: false }) !== undefined
}

function writeStaleSingletonEntries(profileDir: string) {
  for (const name of singletonEntryNames) {
    const entryPath = path.join(profileDir, name)
    // Chromium writes symlinks; a Windows test user without the symlink
    // privilege falls back to plain files, which the cleanup handles too.
    const linked = errore.try(() => symlinkSync('fd4c6e190af9-50', entryPath))
    if (linked instanceof Error) writeFileSync(entryPath, 'fd4c6e190af9-50')
  }
}

function makeDeps(created: FakeContext[]) {
  const secretsDir = mkdtempSync(path.join(tmpdir(), 'chromium-secrets-'))
  writeFileSync(path.join(secretsDir, 'demo_token'), 'secret-token\n')

  return {
    profileDir: mkdtempSync(path.join(tmpdir(), 'chromium-profile-')),
    secretsDir,
    launch: makeLaunch(created),
  }
}

describe('makeChromiumExecutor', () => {
  it('launches once and opens a fresh page carrying scoped secrets', async () => {
    const created: FakeContext[] = []
    const executor = makeChromiumExecutor(makeDeps(created))

    const context = await executor.acquire(new AbortController().signal, 'demo')
    if (context instanceof Error) throw context

    expect(created).toHaveLength(1)
    expect(created[0].pages).toHaveLength(1)
    expect(context.secrets.read('token')).toBe('secret-token')
  })

  it('reuses the persistent context across acquires with a new page each time', async () => {
    const created: FakeContext[] = []
    const executor = makeChromiumExecutor(makeDeps(created))

    const first = await executor.acquire(new AbortController().signal, 'demo')
    if (first instanceof Error) throw first

    const second = await executor.acquire(new AbortController().signal, 'demo')
    if (second instanceof Error) throw second

    expect(created).toHaveLength(1)
    expect(created[0].pages).toHaveLength(2)
    expect(second.page).not.toBe(first.page)
  })

  it('relaunches after the persistent context closes', async () => {
    const created: FakeContext[] = []
    const executor = makeChromiumExecutor(makeDeps(created))

    const first = await executor.acquire(new AbortController().signal, 'demo')
    if (first instanceof Error) throw first

    created[0].emitClose()

    const second = await executor.acquire(new AbortController().signal, 'demo')
    if (second instanceof Error) throw second

    expect(created).toHaveLength(2)
    expect(created[1].pages).toHaveLength(1)
  })

  it('closes the page when the signal aborts', async () => {
    const created: FakeContext[] = []
    const executor = makeChromiumExecutor(makeDeps(created))
    const controller = new AbortController()

    const context = await executor.acquire(controller.signal, 'demo')
    if (context instanceof Error) throw context

    controller.abort()

    await vi.waitFor(() => {
      expect(created[0].pages[0].closed).toBe(true)
    })
  })

  it('does not return a context when the signal is already aborted', async () => {
    const created: FakeContext[] = []
    const executor = makeChromiumExecutor(makeDeps(created))
    const controller = new AbortController()

    controller.abort(new Error('aborted before acquire'))

    const result = await executor.acquire(controller.signal, 'demo')

    expect(result).toBeInstanceOf(Error)
    expect(created).toHaveLength(0)
  })

  it('does not return a context when the signal aborts during page creation', async () => {
    const newPageStarted = makeDeferred<void>()
    const newPage = makeDeferred<FakePage>()
    const page: FakePage = {
      closeCalls: 0,
      closed: false,
      async close() {
        page.closeCalls += 1
        if (page.closed) return
        page.closed = true
      },
      isClosed: () => page.closed,
    }
    const context = makeFakeContext({
      newPage: async () => {
        newPageStarted.resolve()
        return newPage.promise
      },
    })
    const executor = makeChromiumExecutor({
      profileDir: mkdtempSync(path.join(tmpdir(), 'chromium-profile-')),
      secretsDir: mkdtempSync(path.join(tmpdir(), 'chromium-secrets-')),
      launch: async () => context as unknown as BrowserContext,
    })
    const controller = new AbortController()

    const acquirePromise = executor.acquire(controller.signal, 'demo')
    await newPageStarted.promise
    controller.abort(new Error('aborted during acquire'))
    newPage.resolve(page)

    const result = await acquirePromise

    expect(result).toBeInstanceOf(Error)
    await vi.waitFor(() => {
      expect(page.closed).toBe(true)
    })
  })

  it('closes the initial launch when the first task aborts before launch settles', async () => {
    const launch = makeDeferred<BrowserContext>()
    const firstContext = makeFakeContext()
    const secondContext = makeFakeContext()
    const launchMock = vi
      .fn<LaunchPersistentContext>()
      .mockImplementationOnce(async () => launch.promise)
      .mockImplementationOnce(async () => secondContext as unknown as BrowserContext)
    const executor = makeChromiumExecutor({
      profileDir: mkdtempSync(path.join(tmpdir(), 'chromium-profile-')),
      secretsDir: mkdtempSync(path.join(tmpdir(), 'chromium-secrets-')),
      launch: launchMock,
    })
    const controller = new AbortController()

    const acquirePromise = executor.acquire(controller.signal, 'demo')
    controller.abort(new Error('aborted before launch settles'))
    launch.resolve(firstContext as unknown as BrowserContext)

    const acquired = await acquirePromise

    expect(acquired).toBeInstanceOf(Error)
    await vi.waitFor(() => {
      expect(firstContext.closeCalls).toBe(1)
    })

    const relaunched = await executor.acquire(new AbortController().signal, 'demo')
    if (relaunched instanceof Error) throw relaunched

    expect(launchMock).toHaveBeenCalledTimes(2)
    expect(secondContext.pages).toHaveLength(1)
  })

  it('release closes the page and is idempotent', async () => {
    const created: FakeContext[] = []
    const executor = makeChromiumExecutor(makeDeps(created))

    const context = await executor.acquire(new AbortController().signal, 'demo')
    if (context instanceof Error) throw context

    await executor.release(context)
    await executor.release(context)

    expect(created[0].pages[0].closed).toBe(true)
    expect(created[0].pages[0].closeCalls).toBe(1)
  })

  it('shutdown closes the persistent context once', async () => {
    const created: FakeContext[] = []
    const executor = makeChromiumExecutor(makeDeps(created))

    const context = await executor.acquire(new AbortController().signal, 'demo')
    if (context instanceof Error) throw context

    await executor.shutdown()
    await executor.shutdown()

    expect(created).toHaveLength(1)
    expect(created[0].closeCalls).toBe(1)
  })

  it('shutdown closes an initial launch that is still in flight', async () => {
    const launch = makeDeferred<BrowserContext>()
    const firstContext = makeFakeContext()
    const secondContext = makeFakeContext()
    const launchMock = vi
      .fn<LaunchPersistentContext>()
      .mockImplementationOnce(async () => launch.promise)
      .mockImplementationOnce(async () => secondContext as unknown as BrowserContext)
    const executor = makeChromiumExecutor({
      profileDir: mkdtempSync(path.join(tmpdir(), 'chromium-profile-')),
      secretsDir: mkdtempSync(path.join(tmpdir(), 'chromium-secrets-')),
      launch: launchMock,
    })
    const controller = new AbortController()

    const acquirePromise = executor.acquire(controller.signal, 'demo')
    controller.abort(new Error('aborted before launch settles'))
    const shutdownPromise = executor.shutdown()
    launch.resolve(firstContext as unknown as BrowserContext)

    const acquired = await acquirePromise
    await shutdownPromise

    expect(acquired).toBeInstanceOf(Error)
    expect(firstContext.closeCalls).toBe(1)

    const relaunched = await executor.acquire(new AbortController().signal, 'demo')
    if (relaunched instanceof Error) throw relaunched

    expect(launchMock).toHaveBeenCalledTimes(2)
    expect(secondContext.pages).toHaveLength(1)
  })

  it('shutdown waits for an in-flight initial launch even without an acquire waiting on it', async () => {
    const launch = makeDeferred<BrowserContext>()
    const firstContext = makeFakeContext()
    const secondContext = makeFakeContext()
    const launchMock = vi
      .fn<LaunchPersistentContext>()
      .mockImplementationOnce(async () => launch.promise)
      .mockImplementationOnce(async () => secondContext as unknown as BrowserContext)
    const executor = makeChromiumExecutor({
      profileDir: mkdtempSync(path.join(tmpdir(), 'chromium-profile-')),
      secretsDir: mkdtempSync(path.join(tmpdir(), 'chromium-secrets-')),
      launch: launchMock,
    })

    void executor.acquire(new AbortController().signal, 'demo')
    const shutdownPromise = executor.shutdown()
    launch.resolve(firstContext as unknown as BrowserContext)

    await shutdownPromise

    expect(firstContext.closeCalls).toBe(1)

    const relaunched = await executor.acquire(new AbortController().signal, 'demo')
    if (relaunched instanceof Error) throw relaunched

    expect(launchMock).toHaveBeenCalledTimes(2)
    expect(secondContext.pages).toHaveLength(1)
  })

  it('returns BrowserLaunchError from acquire when launch fails', async () => {
    const failure = new Error('boom')
    const executor = makeChromiumExecutor({
      profileDir: mkdtempSync(path.join(tmpdir(), 'chromium-profile-')),
      secretsDir: mkdtempSync(path.join(tmpdir(), 'chromium-secrets-')),
      launch: async () => {
        throw failure
      },
    })

    const result = await executor.acquire(new AbortController().signal, 'demo')

    expect(result).toBeInstanceOf(BrowserLaunchError)
    // The launch failure must keep its cause, or the service logs an internal
    // error with nothing to diagnose.
    expect((result as BrowserLaunchError).cause).toBe(failure)
  })

  it('removes stale Chromium singleton entries before launching', async () => {
    const profileDir = mkdtempSync(path.join(tmpdir(), 'chromium-profile-'))
    writeStaleSingletonEntries(profileDir)
    expect(singletonEntryNames.filter((name) => entryExists(path.join(profileDir, name)))).toEqual(
      singletonEntryNames,
    )

    const seenAtLaunch: string[] = []
    const executor = makeChromiumExecutor({
      profileDir,
      secretsDir: mkdtempSync(path.join(tmpdir(), 'chromium-secrets-')),
      launch: async (dir) => {
        seenAtLaunch.push(
          ...singletonEntryNames.filter((name) => entryExists(path.join(dir, name))),
        )
        return makeFakeContext() as unknown as BrowserContext
      },
    })

    const context = await executor.acquire(new AbortController().signal, 'demo')
    if (context instanceof Error) throw context

    expect(seenAtLaunch).toEqual([])
  })

  it('still launches when a singleton entry cannot be removed', async () => {
    const profileDir = mkdtempSync(path.join(tmpdir(), 'chromium-profile-'))
    // A non-empty directory cannot be removed without a recursive delete, which
    // the cleanup deliberately does not perform.
    mkdirSync(path.join(profileDir, 'SingletonLock'))
    writeFileSync(path.join(profileDir, 'SingletonLock', 'child'), 'x')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const created: FakeContext[] = []
    const executor = makeChromiumExecutor({
      profileDir,
      secretsDir: mkdtempSync(path.join(tmpdir(), 'chromium-secrets-')),
      launch: makeLaunch(created),
    })

    const context = await executor.acquire(new AbortController().signal, 'demo')
    if (context instanceof Error) throw context

    expect(created).toHaveLength(1)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('retains a marked page until the same widget acquires again', async () => {
    const created: FakeContext[] = []
    const executor = makeChromiumExecutor(makeDeps(created))

    const first = await executor.acquire(new AbortController().signal, 'passport-checker')
    if (first instanceof Error) throw first
    await first.detectUserInput(async () => true)
    await executor.release(first)

    expect(created[0].pages[0].closed).toBe(false)

    const retry = await executor.acquire(new AbortController().signal, 'passport-checker')
    if (retry instanceof Error) throw retry
    expect(created[0].pages[0].closed).toBe(true)
    expect(created[0].pages[1].closed).toBe(false)
    await executor.release(retry)
  })

  it('does not discard another widget recovery page', async () => {
    const created: FakeContext[] = []
    const executor = makeChromiumExecutor(makeDeps(created))

    const recovery = await executor.acquire(new AbortController().signal, 'passport-checker')
    if (recovery instanceof Error) throw recovery
    await recovery.detectUserInput(async () => true)
    await executor.release(recovery)

    const diagnostics = await executor.acquire(new AbortController().signal, '__diagnostics__')
    if (diagnostics instanceof Error) throw diagnostics
    expect(created[0].pages[0].closed).toBe(false)
    await executor.release(diagnostics)
  })

  it('abort closes a page even after it was marked for recovery', async () => {
    const created: FakeContext[] = []
    const executor = makeChromiumExecutor(makeDeps(created))
    const controller = new AbortController()
    const context = await executor.acquire(controller.signal, 'passport-checker')
    if (context instanceof Error) throw context

    await context.detectUserInput(async () => true)
    controller.abort()

    await vi.waitFor(() => expect(created[0].pages[0].closed).toBe(true))
    await executor.release(context)
  })

  it('shutdown closes a retained recovery page with its persistent context', async () => {
    const created: FakeContext[] = []
    const executor = makeChromiumExecutor(makeDeps(created))
    const context = await executor.acquire(new AbortController().signal, 'passport-checker')
    if (context instanceof Error) throw context

    await context.detectUserInput(async () => true)
    await executor.release(context)
    await executor.shutdown()

    expect(created[0].closed).toBe(true)
    expect(created[0].pages[0].closed).toBe(true)
  })

  it('reports a retained page only while it is open', async () => {
    const created: FakeContext[] = []
    const executor = makeChromiumExecutor(makeDeps(created))

    expect(executor.hasRetainedPage('passport-checker')).toBe(false)

    const context = await executor.acquire(new AbortController().signal, 'passport-checker')
    if (context instanceof Error) throw context
    await context.detectUserInput(async () => true)
    await executor.release(context)

    expect(executor.hasRetainedPage('passport-checker')).toBe(true)
    expect(executor.hasRetainedPage('other-widget')).toBe(false)
  })

  it('forgets a retained page that Chromium closed on its own', async () => {
    const created: FakeContext[] = []
    const executor = makeChromiumExecutor(makeDeps(created))

    const context = await executor.acquire(new AbortController().signal, 'passport-checker')
    if (context instanceof Error) throw context
    await context.detectUserInput(async () => true)
    await executor.release(context)
    await created[0].pages[0].close()

    expect(executor.hasRetainedPage('passport-checker')).toBe(false)
    // The stale entry is dropped, so a later acquire has nothing to close.
    expect(created[0].pages[0].closeCalls).toBe(1)
  })

  it('returns null and leaves the page unretained when the detector declines', async () => {
    const created: FakeContext[] = []
    const executor = makeChromiumExecutor(makeDeps(created))
    const context = await executor.acquire(new AbortController().signal, 'passport-checker')
    if (context instanceof Error) throw context

    expect(await context.detectUserInput(async () => false)).toBeNull()
    await executor.release(context)

    expect(executor.hasRetainedPage('passport-checker')).toBe(false)
  })

  it('retains the page and returns the canonical error when the detector matches', async () => {
    const created: FakeContext[] = []
    const executor = makeChromiumExecutor({
      ...makeDeps(created),
      recoverySshTarget: 'pi@myboard.local',
    })
    const context = await executor.acquire(new AbortController().signal, 'passport-checker')
    if (context instanceof Error) throw context

    const escalation = await context.detectUserInput(async () => true)
    expect(escalation).toBeInstanceOf(UserInputRequiredError)
    expect((escalation as UserInputRequiredError).sshTarget).toBe('pi@myboard.local')

    await executor.release(context)
    expect(executor.hasRetainedPage('passport-checker')).toBe(true)
  })

  it('reports a null ssh target when none is configured', async () => {
    const created: FakeContext[] = []
    const executor = makeChromiumExecutor(makeDeps(created))
    const context = await executor.acquire(new AbortController().signal, 'passport-checker')
    if (context instanceof Error) throw context

    const escalation = await context.detectUserInput(async () => true)
    expect((escalation as UserInputRequiredError).sshTarget).toBeNull()
    await executor.release(context)
  })

  it('hands the acquired page to the detector', async () => {
    const created: FakeContext[] = []
    const executor = makeChromiumExecutor(makeDeps(created))
    const context = await executor.acquire(new AbortController().signal, 'passport-checker')
    if (context instanceof Error) throw context

    const detector = vi.fn(async () => false)
    await context.detectUserInput(detector)
    expect(detector).toHaveBeenCalledWith(context.page)
    await executor.release(context)
  })

  // An undecidable check is not the same as "no challenge": nobody knows whether
  // a human could act on this page, so pinning it open for a recovery that will
  // never happen is worse than failing the task.
  it.each<[string, UserInputDetector]>([
    ['returned an Error', async () => new Error('probe failed')],
    ['rejected with an Error', () => Promise.reject(new Error('probe threw'))],
    ['rejected with a non-Error', () => Promise.reject('target closed')],
  ])(
    'wraps a detector that %s as a probe error and leaves the page unretained',
    async (_kind, detector) => {
      const created: FakeContext[] = []
      const executor = makeChromiumExecutor(makeDeps(created))
      const context = await executor.acquire(new AbortController().signal, 'passport-checker')
      if (context instanceof Error) throw context

      const result = await context.detectUserInput(detector)
      expect(result).toBeInstanceOf(UserInputProbeError)

      await executor.release(context)
      expect(executor.hasRetainedPage('passport-checker')).toBe(false)
    },
  )

  // The prepare-before-retain ordering itself is asserted in
  // user-input/detect.test.ts, against the two injected callbacks; it cannot be
  // observed from here, because hasRetainedPage() is only populated at
  // release(). What this test owns is the wiring the executor supplies: the
  // acquired page reaches prepare, and a matched detection retains that page.
  it('gives prepare the acquired page and retains it once the detector matched', async () => {
    const created: FakeContext[] = []
    const executor = makeChromiumExecutor(makeDeps(created))

    const declined = await executor.acquire(new AbortController().signal, 'passport-checker')
    if (declined instanceof Error) throw declined
    const skippedPrepare = vi.fn(async () => undefined)
    await declined.detectUserInput(async () => false, { prepare: skippedPrepare })
    expect(skippedPrepare).not.toHaveBeenCalled()
    await executor.release(declined)
    expect(executor.hasRetainedPage('passport-checker')).toBe(false)

    const matched = await executor.acquire(new AbortController().signal, 'passport-checker')
    if (matched instanceof Error) throw matched
    // The explicit parameter is what makes toHaveBeenCalledWith below type-check:
    // an inferred zero-argument mock accepts no expected arguments.
    const prepare = vi.fn(async (_page: Page) => undefined)
    await matched.detectUserInput(async () => true, { prepare })
    expect(prepare).toHaveBeenCalledOnce()
    expect(prepare).toHaveBeenCalledWith(matched.page)
    await executor.release(matched)
    expect(executor.hasRetainedPage('passport-checker')).toBe(true)
  })

  it('escalates even when prepare fails, and says so in the log', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const created: FakeContext[] = []
    const executor = makeChromiumExecutor(makeDeps(created))
    const context = await executor.acquire(new AbortController().signal, 'passport-checker')
    if (context instanceof Error) throw context

    const escalation = await context.detectUserInput(async () => true, {
      prepare: async () => {
        throw new Error('prepare failed')
      },
    })
    expect(escalation).toBeInstanceOf(UserInputRequiredError)
    expect(warn).toHaveBeenCalled()

    await executor.release(context)
    expect(executor.hasRetainedPage('passport-checker')).toBe(true)
    warn.mockRestore()
  })
})
