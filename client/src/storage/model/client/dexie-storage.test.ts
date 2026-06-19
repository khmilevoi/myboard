import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, clearExpired } from './db'
import { createDexieStorage } from './dexie-storage'
import { instanceNamespace } from '../scope'
import { installFakeBroadcastChannel } from '../test/fakes'

const ns = instanceNamespace('inst-1')
const storage = createDexieStorage(ns)

beforeEach(async () => {
  await db.entries.clear()
})

afterEach(async () => {
  await db.entries.clear()
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
  beforeEach(() => {
    installFakeBroadcastChannel()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

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
})
