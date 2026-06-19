import 'fake-indexeddb/auto'
import { context, wrap } from '@reatom/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../client/db'
import { createDexieStorage } from '../client/dexie-storage'
import { instanceNamespace } from '../scope'
import { StorageError, type StorageApi } from '../types'
import { reatomStorageMutations, reatomClearExpired, reatomStorageKey } from './reatom-storage'
import { installFakeBroadcastChannel } from '../test/fakes'

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

describe('reatomStorageKey', () => {
  beforeEach(() => {
    installFakeBroadcastChannel()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reflects the current value and live updates while connected', async () => {
    const api: StorageApi = createDexieStorage(instanceNamespace('inst-1'))
    await api.set('draft', 1)
    const key = reatomStorageKey({ api, key: 'draft' }, 'test.draft')
    await context.start(async () => {
      const off = key.value.subscribe(() => {}) // connect the atom
      const check1 = wrap(() => expect(key.value()).toBe(1))
      const check2 = wrap(() => expect(key.value()).toBe(2))
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
    const key = reatomStorageKey({ api, key: 'k' }, 'test.k')
    await context.start(async () => {
      const off = key.value.subscribe(() => {})
      const checkSubscribe = wrap(() => expect(api.subscribe).toHaveBeenCalled())
      await vi.waitFor(() => checkSubscribe())
      off()
    })
    await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalled())
  })
})
