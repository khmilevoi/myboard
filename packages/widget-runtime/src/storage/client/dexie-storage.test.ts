import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { instanceNamespace } from '../scope'
import { db, clearExpired, purgeLocalData } from './db'
import { makeDexieStorage } from './dexie-storage'

const ns = instanceNamespace('inst-1')
const storage = makeDexieStorage(ns)

beforeEach(async () => {
  await db.entries.clear()
})

afterEach(async () => {
  // purgeLocalData's test closes/deletes the shared db as its last act; the
  // db no longer exists to clear afterward.
  if (db.isOpen()) await db.entries.clear()
})

describe('createDexieStorage', () => {
  it('sets and gets a value', async () => {
    await storage.set('draft', { text: 'hi' })
    expect(await storage.get<{ text: string }>('draft')).toEqual({ text: 'hi' })
  })

  it('returns null for a missing key', async () => {
    expect(await storage.get('missing')).toBeNull()
  })

  it('reports presence with has', async () => {
    expect(await storage.has('draft')).toBe(false)
    await storage.set('draft', 1)
    expect(await storage.has('draft')).toBe(true)
  })

  it('deletes a value', async () => {
    await storage.set('draft', 1)
    await storage.delete('draft')
    expect(await storage.get('draft')).toBeNull()
  })

  it('expires a value on read and removes the row', async () => {
    await storage.set('temp', 1, { ttlMs: -1 })
    expect(await storage.get('temp')).toBeNull()
    expect(await db.entries.get(`${ns}temp`)).toBeUndefined()
  })

  it('lists relative keys within the namespace, filtered by prefix', async () => {
    await storage.set('a', 1)
    await storage.set('group:b', 2)
    expect(await storage.keys()).toEqual(expect.arrayContaining(['a', 'group:b']))
    expect(await storage.keys('group:')).toEqual(['group:b'])
  })

  it('append creates an array then appends to it', async () => {
    await storage.append('log', { a: 1 })
    await storage.append('log', { a: 2 })
    expect(await storage.get('log')).toEqual([{ a: 1 }, { a: 2 }])
  })

  it('append caps to the last N entries', async () => {
    await storage.append('log', { n: 1 })
    await storage.append('log', { n: 2 })
    await storage.append('log', { n: 3 }, { cap: 2 })
    expect(await storage.get('log')).toEqual([{ n: 2 }, { n: 3 }])
  })

  it('serializes concurrent appends for the same key', async () => {
    const fullKey = `${ns}log`
    const state = new Map<string, unknown>([
      [
        fullKey,
        {
          key: fullKey,
          namespace: ns,
          value: [{ n: 1 }],
          expiresAt: null,
          updatedAt: 1,
        },
      ],
    ])
    let releaseFirstPut = () => {}
    let putCalls = 0
    const storage = makeDexieStorage(ns, {
      entries: {
        get: vi.fn(async (key: string) => {
          const entry = state.get(key)
          return entry === undefined ? undefined : structuredClone(entry)
        }),
        put: vi.fn(async (entry: { key: string; value: unknown }) => {
          putCalls += 1
          if (putCalls === 1)
            await new Promise<void>((resolve) => {
              releaseFirstPut = resolve
            })
          state.set(entry.key, entry)
        }),
        delete: vi.fn(async () => undefined),
        where: vi.fn(() => ({
          startsWith: vi.fn(() => ({
            toArray: vi.fn(async () => []),
          })),
        })),
      },
    } as never)

    const first = storage.append('log', { n: 2 })
    await vi.waitFor(() => expect(putCalls).toBe(1))
    const second = storage.append('log', { n: 3 })
    await Promise.resolve()
    releaseFirstPut()
    await Promise.all([first, second])

    expect((state.get(fullKey) as { value: unknown[] }).value).toEqual([
      { n: 1 },
      { n: 2 },
      { n: 3 },
    ])
  })

  it('clearExpired removes only expired rows', async () => {
    await storage.set('live', 1)
    await storage.set('dead', 1, { ttlMs: -1 })
    await clearExpired()
    expect(await db.entries.get(`${ns}live`)).toBeDefined()
    expect(await db.entries.get(`${ns}dead`)).toBeUndefined()
  })

  it('get validates against a schema and returns StorageError on mismatch', async () => {
    const { z } = await import('zod')
    const schema = z.object({ text: z.string() })
    await storage.set('draft', { text: 'hi' })
    expect(await storage.get('draft', schema)).toEqual({ text: 'hi' })
    await storage.set('draft', { text: 123 })
    const { StorageError } = await import('../types')
    expect(await storage.get('draft', schema)).toBeInstanceOf(StorageError)
  })
})

describe('createDexieStorage subscribe', () => {
  it('emits the current value on subscribe then on each change', async () => {
    await storage.set('draft', { text: 'first' })
    const seen: unknown[] = []
    const off = storage.subscribe<{ text: string }>('draft', (event) => {
      seen.push(event instanceof Error ? 'error' : event.value)
    })
    // initial emit is async (best-effort get)
    await vi.waitFor(() => expect(seen.length).toBeGreaterThanOrEqual(1))
    await storage.set('draft', { text: 'second' })
    await storage.delete('draft')
    off()
    expect(seen).toEqual([{ text: 'first' }, { text: 'second' }, null])
  })

  it('clearExpired broadcasts a tombstone for purged keys', async () => {
    const seen: unknown[] = []
    storage.subscribe('temp', (event) => {
      seen.push(event instanceof Error ? 'error' : event.value)
    })
    await vi.waitFor(() => expect(seen.length).toBe(1)) // initial emit: null (missing)
    seen.length = 0
    await db.entries.put({
      key: `${ns}temp`,
      namespace: ns,
      value: 5,
      expiresAt: Date.now() - 1,
      updatedAt: Date.now(),
    })
    await clearExpired()
    await vi.waitFor(() => expect(seen).toEqual([null]))
  })

  it('purgeLocalData drops the database', async () => {
    const purgeStorage = makeDexieStorage('w:t:purge:')
    await purgeStorage.set('k', 1)
    await purgeLocalData()
    expect(await Dexie.exists('myboard-storage')).toBe(false)
  })
})
