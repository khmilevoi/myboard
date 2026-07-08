import { describe, expect, it, vi } from 'vitest'

vi.mock('widget-runtime', () => ({ purgeLocalData: vi.fn(async () => undefined) }))

import { purgeLocalData } from 'widget-runtime'

import { purgeLocalSession } from './purge'

describe('purgeLocalSession', () => {
  it('purges Dexie, caches, and service workers', async () => {
    const cacheDelete = vi.fn(async () => true)
    vi.stubGlobal('caches', { keys: async () => ['a', 'b'], delete: cacheDelete })
    const unregister = vi.fn(async () => true)
    vi.stubGlobal('navigator', {
      serviceWorker: { getRegistrations: async () => [{ unregister }] },
    })

    await purgeLocalSession()

    expect(purgeLocalData).toHaveBeenCalledTimes(1)
    expect(cacheDelete).toHaveBeenCalledWith('a')
    expect(cacheDelete).toHaveBeenCalledWith('b')
    expect(unregister).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  it('survives environments without caches/serviceWorker', async () => {
    vi.stubGlobal('navigator', {})
    await expect(purgeLocalSession()).resolves.toBeUndefined()
    vi.unstubAllGlobals()
  })
})
