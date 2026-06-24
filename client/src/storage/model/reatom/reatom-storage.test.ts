import 'fake-indexeddb/auto'
import { atom, context, wrap } from '@reatom/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '../client/db'
import { createDexieStorage } from '../client/dexie-storage'
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
    const api: StorageApi = createDexieStorage(instanceNamespace('inst-1'))
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
    const api = createDexieStorage(instanceNamespace('inst-1'))
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
    const api: StorageApi = createDexieStorage(instanceNamespace('inst-1'))
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
    const real = createDexieStorage(instanceNamespace('inst-ro'))
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
})
