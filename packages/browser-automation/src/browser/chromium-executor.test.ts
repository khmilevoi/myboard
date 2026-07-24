import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { BrowserContext } from 'playwright'
import { describe, expect, it, vi } from 'vitest'

import {
  BrowserLaunchError,
  makeChromiumExecutor,
  type LaunchPersistentContext,
} from './chromium-executor'

type FakePage = {
  closeCalls: number
  closed: boolean
  close: () => Promise<void>
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
    const executor = makeChromiumExecutor({
      profileDir: mkdtempSync(path.join(tmpdir(), 'chromium-profile-')),
      secretsDir: mkdtempSync(path.join(tmpdir(), 'chromium-secrets-')),
      launch: async () => {
        throw new Error('boom')
      },
    })

    const result = await executor.acquire(new AbortController().signal, 'demo')

    expect(result).toBeInstanceOf(BrowserLaunchError)
  })

  it('retains a marked page until the same widget acquires again', async () => {
    const created: FakeContext[] = []
    const executor = makeChromiumExecutor(makeDeps(created))

    const first = await executor.acquire(new AbortController().signal, 'passport-checker')
    if (first instanceof Error) throw first
    first.retainPageForRecovery()
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
    recovery.retainPageForRecovery()
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

    context.retainPageForRecovery()
    controller.abort()

    await vi.waitFor(() => expect(created[0].pages[0].closed).toBe(true))
    await executor.release(context)
  })

  it('shutdown closes a retained recovery page with its persistent context', async () => {
    const created: FakeContext[] = []
    const executor = makeChromiumExecutor(makeDeps(created))
    const context = await executor.acquire(new AbortController().signal, 'passport-checker')
    if (context instanceof Error) throw context

    context.retainPageForRecovery()
    await executor.release(context)
    await executor.shutdown()

    expect(created[0].closed).toBe(true)
    expect(created[0].pages[0].closed).toBe(true)
  })
})
