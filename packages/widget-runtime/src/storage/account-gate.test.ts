import { context } from '@reatom/core'
import type { HttpLike } from '@shared/http/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { makeStaticWidgetIdentity, makeWidgetIdentity } from '../identity'
import {
  localNamespaceFor,
  makeAccountGatedStorage,
  makeIdentityAccountGate,
  type AccountGate,
} from './account-gate'
import { StorageError, type StorageApi, type StorageChange, type StorageListener } from './types'

afterEach(() => context.reset())

function makeManualGate(initial: string | null) {
  let current = initial
  const listeners = new Set<(accountId: string | null) => void>()
  const gate: AccountGate = {
    current: () => current,
    subscribe(listener) {
      listeners.add(listener)
      listener(current)
      return () => listeners.delete(listener)
    },
  }
  const set = (next: string | null) => {
    current = next
    for (const listener of listeners) listener(next)
  }
  return { gate, set }
}

/** A storage whose every key reads as `<accountId>:<key>`, delivered synchronously on subscribe. */
function makeAccountEcho(accountId: string): StorageApi & { unsubscribed: string[] } {
  const unsubscribed: string[] = []
  const unsupported = async () => new StorageError({ reason: 'unsupported' })
  return {
    unsubscribed,
    get: async <T>(key: string) => `${accountId}:${key}` as T,
    set: unsupported,
    delete: unsupported,
    has: unsupported,
    keys: unsupported,
    append: unsupported,
    subscribe<T>(key: string, listener: StorageListener<T>) {
      listener({ value: `${accountId}:${key}` as T })
      return () => unsubscribed.push(key)
    },
  }
}

describe('makeAccountGatedStorage', () => {
  it('fails direct operations until the account is known', async () => {
    const { gate, set } = makeManualGate(null)
    const storage = makeAccountGatedStorage(gate, makeAccountEcho)

    const result = await storage.get('k')
    expect(result).toBeInstanceOf(StorageError)
    expect(result).toMatchObject({ reason: 'account_unavailable' })
    expect(await storage.set('k', 1)).toMatchObject({ reason: 'account_unavailable' })
    expect(await storage.keys()).toMatchObject({ reason: 'account_unavailable' })

    set('a1')
    expect(await storage.get('k')).toBe('a1:k')
  })

  it('holds a subscription until the account arrives, then follows account changes', () => {
    const { gate, set } = makeManualGate(null)
    const built = new Map<string, ReturnType<typeof makeAccountEcho>>()
    const storage = makeAccountGatedStorage(gate, (accountId) => {
      const echo = makeAccountEcho(accountId)
      built.set(accountId, echo)
      return echo
    })
    const seen: unknown[] = []
    const off = storage.subscribe('k', (event) => {
      seen.push(event instanceof Error ? event : (event as StorageChange).value)
    })

    expect(seen).toEqual([])
    set('a1')
    expect(seen).toEqual(['a1:k'])
    set('a2')
    expect(seen).toEqual(['a1:k', 'a2:k'])
    expect(built.get('a1')?.unsubscribed).toEqual(['k'])

    off()
    expect(built.get('a2')?.unsubscribed).toEqual(['k'])
    set('a3')
    expect(seen).toEqual(['a1:k', 'a2:k'])
  })

  it('caches one built storage per account', async () => {
    const { gate, set } = makeManualGate('a1')
    const build = vi.fn(makeAccountEcho)
    const storage = makeAccountGatedStorage(gate, build)

    await storage.get('x')
    await storage.get('y')
    set('a2')
    await storage.get('x')
    set('a1')
    await storage.get('x')
    expect(build.mock.calls.map(([accountId]) => accountId)).toEqual(['a1', 'a2'])
  })
})

describe('makeIdentityAccountGate', () => {
  it('reads the viewer from identity lazily', () => {
    const identity = makeStaticWidgetIdentity({
      members: [{ accountId: 'a1', name: 'A' }],
      viewerAccountId: 'a1',
    })
    const gate = makeIdentityAccountGate(identity)
    const seen: (string | null)[] = []
    gate.subscribe((id) => seen.push(id))
    expect(seen.at(-1)).toBe('a1')
    expect(gate.current()).toBe('a1')
  })

  it('reports no account for a host without a viewer', () => {
    const gate = makeIdentityAccountGate(makeStaticWidgetIdentity())
    expect(gate.current()).toBeNull()
  })

  it('sends no identity request until the gate is first used', async () => {
    const get = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: { accounts: [{ accountId: 'a1', name: 'A' }], viewerAccountId: 'a1' },
    }))
    const http = { get, post: vi.fn() } as unknown as HttpLike
    const gate = makeIdentityAccountGate(makeWidgetIdentity({ http }))
    expect(get).not.toHaveBeenCalled()

    const seen: (string | null)[] = []
    const off = gate.subscribe((id) => seen.push(id))
    // reatom runs connect hooks after the subscribing call returns.
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(seen.at(-1)).toBe('a1'))
    expect(gate.current()).toBe('a1')
    off()
  })
})

describe('localNamespaceFor', () => {
  it('uses the same namespaces as the server', () => {
    expect(localNamespaceFor({ owner: 'widget', id: 'clock', scope: 'account' }, 'a1')).toBe(
      'w:a:clock:a1:',
    )
    expect(localNamespaceFor({ owner: 'module', id: 'ofelia', scope: 'shared' }, null)).toBe(
      'm:ofelia:s:',
    )
    expect(localNamespaceFor({ owner: 'module', id: 'ofelia', scope: 'account' }, 'a1')).toBe(
      'm:ofelia:a:a1:',
    )
  })
})
