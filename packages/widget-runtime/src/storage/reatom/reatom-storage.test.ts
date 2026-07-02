import 'fake-indexeddb/auto'
import { atom, computed, context, effect, wrap } from '@reatom/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '../client/db'
import { makeDexieStorage } from '../client/dexie-storage'
import { instanceNamespace } from '../scope'
import { installFakeBroadcastChannel } from '../test/fakes'
import { StorageError, type StorageApi } from '../types'
import {
  reatomStorageMutations,
  reatomClearExpired,
  withStorageKey,
  withStorageKeyReadonly,
} from './reatom-storage'

beforeEach(async () => {
  await db.entries.clear()
})

afterEach(() => {
  context.reset()
})

describe('reatomStorageMutations', () => {
  it('set forwards to the api and leaves error undefined on success', async () => {
    const api: StorageApi = makeDexieStorage(instanceNamespace('inst-1'))
    const { set } = reatomStorageMutations(api, 'test')
    await context.start(async () => {
      await set('draft', 42)
    })
    expect(await api.get('draft')).toBe(42)
  })

  it('set records a StorageError on failure', async () => {
    const failing: StorageApi = {
      get: vi.fn(),
      set: vi.fn(async () => new StorageError({ reason: 'boom' })),
      delete: vi.fn(),
      has: vi.fn(),
      keys: vi.fn(),
    } as unknown as StorageApi
    const { set } = reatomStorageMutations(failing, 'test')
    await context.start(async () => {
      await wrap(set('draft', 1).catch(() => {}))
      expect(set.error()).toBeInstanceOf(StorageError)
    })
  })
})

describe('reatomClearExpired', () => {
  it('removes expired client rows', async () => {
    const api = makeDexieStorage(instanceNamespace('inst-1'))
    await api.set('dead', 1, { ttlMs: -1 })
    const clear = reatomClearExpired('test')
    await context.start(async () => {
      await clear()
    })
    expect(await db.entries.get('w:i:inst-1:dead')).toBeUndefined()
  })
})

describe('withStorageKey', () => {
  beforeEach(() => {
    installFakeBroadcastChannel()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reflects the current value and live updates while connected', async () => {
    const api: StorageApi = makeDexieStorage(instanceNamespace('inst-1'))
    await api.set('draft', 1)
    const key = atom<number | null>(null, 'test.draft').extend(
      withStorageKey({ api, key: 'draft' }),
    )
    await context.start(async () => {
      const off = key.subscribe(() => {}) // connect the atom
      const check1 = wrap(() => expect(key()).toBe(1))
      const check2 = wrap(() => expect(key()).toBe(2))
      await vi.waitFor(() => check1())
      await api.set('draft', 2)
      await vi.waitFor(() => check2())
      off()
    })
  })

  it('settles with the optimistic value and a bounded write count when the backend always fails', async () => {
    // Regression: a persistently failing backend (server down, quota, ...)
    // must NOT livelock the graph. The old revert-on-failed-write behavior
    // resonated with effects that re-fill a default (selectInitialActiveBoard
    // pattern): write fails → revert to null → effect writes default → write
    // fails → ... an unbounded microtask cycle that starves timers.
    const set = vi.fn(async () => {
      // Yield a macrotask per attempt so a runaway cycle cannot starve the
      // test's own timers — the call COUNT is the livelock evidence.
      await new Promise((resolve) => setTimeout(resolve, 0))
      return new StorageError({ reason: 'backend down' })
    })
    const api = {
      get: vi.fn(async () => null),
      set,
      delete: vi.fn(),
      has: vi.fn(),
      keys: vi.fn(),
      subscribe: vi.fn((_key: string, listener: (event: { value: null }) => void) => {
        listener({ value: null }) // empty backend: no stored value
        return () => {}
      }),
    } as unknown as StorageApi

    const key = atom<string | null>(null, 'test.active').extend(
      withStorageKey({ api, key: 'active' }),
    )
    const ensureDefault = effect(() => {
      if (key.isLoading()) return
      if (key() === null) key.set('default')
    }, 'test.ensureDefault')

    // Deliberately NOT inside context.start: the app runs in the global
    // context, and the failing-write continuation must work there.
    const offKey = key.subscribe(() => {})
    const offEffect = ensureDefault.subscribe()

    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(key()).toBe('default') // optimistic value survives the failure
    expect(key.error()).toBeInstanceOf(StorageError)
    offEffect()
    offKey()

    // One local change → one write attempt (the failure is reported, not retried).
    expect(set).toHaveBeenCalledTimes(1)
  })

  it('unsubscribes from the api on disconnect', async () => {
    const unsubscribe = vi.fn()
    const api = {
      get: vi.fn(async () => null),
      set: vi.fn(),
      delete: vi.fn(),
      has: vi.fn(),
      keys: vi.fn(),
      subscribe: vi.fn(() => unsubscribe),
    } as unknown as StorageApi
    const key = atom<null>(null, 'test.k').extend(withStorageKey({ api, key: 'k' }))
    await context.start(async () => {
      const off = key.subscribe(() => {})
      const checkSubscribe = wrap(() => expect(api.subscribe).toHaveBeenCalled())
      await vi.waitFor(() => checkSubscribe())
      off()
    })
    await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalled())
  })
})

describe('withStorageKeyReadonly', () => {
  beforeEach(() => {
    installFakeBroadcastChannel()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('mirrors the stored value, applies fallback on delete, and never writes back', async () => {
    const real = makeDexieStorage(instanceNamespace('inst-ro'))
    const set = vi.fn(real.set)
    const api = { ...real, set } as StorageApi
    await real.set('led', [1, 2, 3])

    const led = atom<number[]>([], 'test.led').extend(
      withStorageKeyReadonly({ api, key: 'led', fallback: [] }),
    )

    await context.start(async () => {
      const off = led.subscribe(() => {})
      const seeded = wrap(() => expect(led()).toEqual([1, 2, 3]))
      await vi.waitFor(() => seeded())
      await real.delete('led')
      const emptied = wrap(() => expect(led()).toEqual([]))
      await vi.waitFor(() => emptied())
      off()
    })

    expect(set).not.toHaveBeenCalled()
  })

  it('follows a computed key: subscribes late, re-subscribes on change, drops old subscriptions', async () => {
    const calls: { key: string; unsubscribe: ReturnType<typeof vi.fn> }[] = []
    const subscribe = vi.fn((key: string) => {
      const unsubscribe = vi.fn()
      calls.push({ key, unsubscribe })
      return unsubscribe
    })
    const api = {
      get: vi.fn(async () => null),
      set: vi.fn(),
      delete: vi.fn(),
      has: vi.fn(),
      keys: vi.fn(),
      subscribe,
    } as unknown as StorageApi

    const week = atom<string | null>(null, 'test.week')
    const followed = atom<number[]>([], 'test.followed').extend(
      withStorageKeyReadonly({
        api,
        key: computed(() => (week() == null ? null : `w:${week()}`), 'test.followedKey'),
        fallback: [],
      }),
    )

    await context.start(async () => {
      const off = followed.subscribe(() => {})
      const setWeek = wrap((value: string) => week.set(value))

      // Null key: connected but no api subscription yet.
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(subscribe).not.toHaveBeenCalled()

      setWeek('a')
      await vi.waitFor(() =>
        expect(subscribe).toHaveBeenCalledWith('w:a', expect.any(Function), undefined),
      )

      setWeek('b')
      await vi.waitFor(() =>
        expect(subscribe).toHaveBeenCalledWith('w:b', expect.any(Function), undefined),
      )
      expect(calls[0]?.unsubscribe).toHaveBeenCalled()

      off()
    })

    // Disconnect drops the live subscription too.
    await vi.waitFor(() => expect(calls[1]?.unsubscribe).toHaveBeenCalled())
  })
})
