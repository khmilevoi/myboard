import {
  moduleAccountNamespace,
  moduleSharedNamespace,
  widgetAccountNamespace,
} from '@shared/storage/scope'
import type { ScopedBranch } from '@shared/storage/scoped'
import type { z } from 'zod'

import type { WidgetIdentity } from '../identity'
import { StorageError, type StorageApi, type StorageListener, type StorageOptions } from './types'

/** The signed-in account a document stores account-scoped data under; null while unknown or absent. */
export type AccountGate = {
  current(): string | null
  /** Called immediately with the current account, then on every change. */
  subscribe(listener: (accountId: string | null) => void): () => void
}

/**
 * Follows `identity.viewer`. Lazy on purpose: the viewer subscription — and with it identity's
 * connect hook, which starts the `/api/auth/accounts` request — is opened on the first
 * `current()` or `subscribe()` call, never at construction, so building a runtime sends nothing.
 * Once opened it is held for the document's lifetime (one gate per runtime). The reatom callback
 * only copies the id into plain state and fans it out to plain listeners, so nothing downstream
 * runs inside a widget frame.
 */
export function makeIdentityAccountGate(identity: WidgetIdentity): AccountGate {
  let accountId: string | null = null
  let started = false
  const listeners = new Set<(accountId: string | null) => void>()

  const start = () => {
    if (started) return
    started = true
    identity.viewer.subscribe((viewer) => {
      const next = viewer?.accountId || null
      if (next === accountId) return
      accountId = next
      for (const listener of listeners) listener(next)
    })
  }

  return {
    current() {
      start()
      return accountId
    },
    subscribe(listener) {
      start()
      listeners.add(listener)
      listener(accountId)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/** The Dexie namespace of a scoped branch: the same namespace functions the server uses. */
export function localNamespaceFor(branch: ScopedBranch, accountId: string | null): string {
  if (branch.scope === 'shared') return moduleSharedNamespace(branch.id)
  // Account branches only reach here through makeAccountGatedStorage, which never builds
  // without an account — the empty fallback is unreachable, not a namespace anyone writes to.
  const id = accountId ?? ''
  return branch.owner === 'widget'
    ? widgetAccountNamespace(branch.id, id)
    : moduleAccountNamespace(branch.id, id)
}

/**
 * Storage that exists only while an account is known. Direct operations without one return
 * `account_unavailable` at once (a harness or a logged-out host never hangs); a subscription waits
 * for the account, then follows it — resubscribing on the new account's storage when it changes.
 * One built storage is cached per account.
 */
export function makeAccountGatedStorage(
  gate: AccountGate,
  build: (accountId: string) => StorageApi,
): StorageApi {
  const built = new Map<string, StorageApi>()
  const storageFor = (accountId: string): StorageApi => {
    const cached = built.get(accountId)
    if (cached) return cached
    const storage = build(accountId)
    built.set(accountId, storage)
    return storage
  }
  const current = (): StorageApi | null => {
    const accountId = gate.current()
    return accountId === null ? null : storageFor(accountId)
  }
  const unavailable = () => new StorageError({ reason: 'account_unavailable' })

  return {
    async get<T>(key: string, schema?: z.ZodType<T>): Promise<StorageError | T | null> {
      const storage = current()
      if (!storage) return unavailable()
      return storage.get(key, schema)
    },

    async set<T>(key: string, value: T, options?: StorageOptions): Promise<StorageError | void> {
      const storage = current()
      if (!storage) return unavailable()
      return storage.set(key, value, options)
    },

    async delete(key: string): Promise<StorageError | void> {
      const storage = current()
      if (!storage) return unavailable()
      return storage.delete(key)
    },

    async has(key: string): Promise<StorageError | boolean> {
      const storage = current()
      if (!storage) return unavailable()
      return storage.has(key)
    },

    async keys(prefix?: string): Promise<StorageError | string[]> {
      const storage = current()
      if (!storage) return unavailable()
      return storage.keys(prefix)
    },

    async append<T extends Record<string, unknown>>(
      key: string,
      entry: T,
      options?: { cap?: number },
    ): Promise<StorageError | void> {
      const storage = current()
      if (!storage) return unavailable()
      return storage.append(key, entry, options)
    },

    subscribe<T>(key: string, listener: StorageListener<T>, schema?: z.ZodType<T>): () => void {
      let active: string | null = null
      let unsubscribeInner: (() => void) | undefined
      let closed = false

      // On an account switch this unsubscribes and resubscribes in one tick. The SSE frame key
      // has no account in it, so the sync diff nets to zero and the server subscription keeps the
      // old account's fullKey (see addScoped in server/sse-client.ts). Safe today: identity loads
      // the viewer once per document. A future account-switch feature must force-resubscribe.
      const unsubscribeGate = gate.subscribe((accountId) => {
        if (closed || accountId === active) return
        unsubscribeInner?.()
        unsubscribeInner = undefined
        active = accountId
        if (accountId !== null) {
          unsubscribeInner = storageFor(accountId).subscribe(key, listener, schema)
        }
      })

      return () => {
        if (closed) return
        closed = true
        unsubscribeGate()
        unsubscribeInner?.()
        unsubscribeInner = undefined
      }
    },
  }
}
