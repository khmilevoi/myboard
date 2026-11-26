import type { HttpLike } from '@shared/http/client'
import type { EventStream, OpenEventStream } from '@shared/http/event-stream'
import { scopedEventKey, type ScopedStorageRef } from '@shared/storage/scoped'
import { z } from 'zod'

export type SseDeliver = (rawValue: unknown) => void
export type SseManager = {
  add(fullKey: string, deliver: SseDeliver): () => void
  /**
   * `account` tags an account-scoped subscription with the account it was opened for. The frame
   * key carries no account, so without the tag an account switch inside one sync tick would net
   * to a zero diff and the server would keep delivering the previous account's key.
   */
  addScoped(ref: ScopedStorageRef, deliver: SseDeliver, account?: string): () => void
}

export type SseManagerDeps = {
  baseUrl: string
  http: HttpLike
  openEventStream: OpenEventStream
}

const REGISTER_RETRY_MS = 1_000
const RECONNECT_DELAY_MS = 2_000

const ReadyEventSchema = z.object({
  connId: z.string(),
})

const StorageEventSchema = z.object({
  key: z.string(),
  value: z.unknown(),
})

// 4xx the same request can never recover from; 401 heals through the client's auth hook,
// 408/429 are transient.
function isPermanentRejection(status: number): boolean {
  return status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429
}

// The registration identity of a scoped subscription: its frame key plus the account it was
// opened for. NUL cannot occur in a frame key, so the two parts never collide.
function scopedRegistrationKey(ref: ScopedStorageRef, account: string | undefined): string {
  const frameKey = scopedEventKey(ref)
  return account === undefined ? frameKey : `${frameKey}\u0000${account}`
}

export function makeSseManager(deps: SseManagerDeps): SseManager {
  const subscribers = new Map<string, Set<SseDeliver>>()
  const desired = new Set<string>()
  let registered = new Set<string>()
  // Keyed by scopedRegistrationKey (frame key + account), not by frame key.
  const desiredScoped = new Map<string, ScopedStorageRef>()
  const scopedRefCounts = new Map<string, number>()
  let registeredScoped = new Map<string, ScopedStorageRef>()
  let connId: string | undefined
  let syncScheduled = false
  let syncInFlight = false
  let syncDirty = false
  let retryTimer: ReturnType<typeof setTimeout> | undefined

  let stream: EventStream | undefined
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined

  function scheduleRetry(): void {
    if (retryTimer) return
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      scheduleSync()
    }, REGISTER_RETRY_MS)
  }

  function parseFrame(data: string): unknown | Error {
    try {
      return JSON.parse(data) as unknown
    } catch (cause) {
      return new Error('invalid SSE JSON', { cause })
    }
  }

  function onReady(raw: unknown): void {
    const parsed = ReadyEventSchema.safeParse(raw)
    if (!parsed.success) {
      console.warn('invalid storage SSE ready frame', parsed.error)
      return
    }
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = undefined
    }
    connId = parsed.data.connId
    registered = new Set()
    registeredScoped = new Map() // new connection: server knows nothing yet
    scheduleSync()
  }

  function onStorageEvent(raw: unknown): void {
    const parsed = StorageEventSchema.safeParse(raw)
    if (!parsed.success) {
      console.warn('invalid storage SSE message frame', parsed.error)
      return
    }
    const set = subscribers.get(parsed.data.key)
    if (set) for (const deliver of set) deliver(parsed.data.value)
  }

  function connect(): void {
    stream = deps.openEventStream(`${deps.baseUrl}/events`, {
      events: ['ready'],
      onMessage: (message) => {
        const raw = parseFrame(message.data)
        if (raw instanceof Error) {
          console.warn('invalid storage SSE frame', raw)
          return
        }
        if (message.event === 'ready') onReady(raw)
        else onStorageEvent(raw)
      },
      onError: () => {
        // The port only reports fatal closes (e.g. the gate answered 401);
        // transient blips are retried by EventSource itself.
        stream?.close()
        stream = undefined
        connId = undefined
        scheduleReconnect()
      },
    })
  }

  // Fixed 2 s, no backoff, retry forever, no re-auth — deliberate. The
  // common fatal close is a server deploy/restart (nginx up, upstream down →
  // non-200 → CLOSED), where fast indefinite retry brings the board back by
  // itself. The connect attempt IS the session probe: while the session is
  // dead the gate answers non-200 and the loop just keeps ticking; healing
  // arrives through the board client's 401 retry hook on the next real
  // request, and the following tick reconnects. Running a WebAuthn ceremony
  // from this timer would pop a passkey prompt with no user gesture.
  function scheduleReconnect(): void {
    if (reconnectTimer) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined
      connect()
    }, RECONNECT_DELAY_MS)
  }

  connect()

  function scheduleSync(): void {
    if (syncScheduled) return
    syncScheduled = true
    queueMicrotask(() => {
      syncScheduled = false
      void sync()
    })
  }

  async function sync(): Promise<void> {
    if (syncInFlight) {
      syncDirty = true
      return
    }
    if (!connId) return
    const subscribe = [...desired].filter((key) => !registered.has(key))
    const unsubscribe = [...registered].filter((key) => !desired.has(key))
    const scopedSubscribeEntries = [...desiredScoped].filter(([key]) => !registeredScoped.has(key))
    const scopedUnsubscribeEntries = [...registeredScoped].filter(
      ([key]) => !desiredScoped.has(key),
    )
    const scopedSubscribe = scopedSubscribeEntries.map(([, ref]) => ref)
    const scopedUnsubscribe = scopedUnsubscribeEntries.map(([, ref]) => ref)
    const hasScoped = scopedSubscribe.length > 0 || scopedUnsubscribe.length > 0
    if (subscribe.length === 0 && unsubscribe.length === 0 && !hasScoped) return

    const requestConnId = connId
    const nextRegistered = new Set(desired)
    const nextRegisteredScoped = new Map(desiredScoped)
    syncInFlight = true
    const result = await deps.http.post(`${deps.baseUrl}/events/${requestConnId}`, {
      json: {
        subscribe,
        unsubscribe,
        ...(hasScoped
          ? { scoped: { subscribe: scopedSubscribe, unsubscribe: scopedUnsubscribe } }
          : {}),
      },
    })
    syncInFlight = false

    if (connId !== requestConnId) {
      syncDirty = false
      scheduleSync()
      return
    }

    if (
      !(result instanceof Error) &&
      !result.ok &&
      hasScoped &&
      isPermanentRejection(result.status)
    ) {
      // The server answers the POST atomically, so one rejected scoped ref (422/404/403) would
      // otherwise block plain registration forever. Drop the rejected scoped entries and
      // re-sync, so the plain part of the diff registers.
      console.warn('storage SSE scoped registration rejected', result.status)
      for (const [key] of scopedSubscribeEntries) desiredScoped.delete(key)
      for (const [key] of scopedUnsubscribeEntries) registeredScoped.delete(key)
      syncDirty = false
      scheduleSync()
      return
    }

    if (result instanceof Error || !result.ok) {
      console.warn(
        'storage SSE registration failed',
        result instanceof Error ? result : result.status,
      )
      syncDirty = false
      scheduleRetry()
      return
    }

    registered = nextRegistered
    registeredScoped = nextRegisteredScoped
    const needsResync =
      syncDirty ||
      [...desired].some((key) => !registered.has(key)) ||
      [...registered].some((key) => !desired.has(key)) ||
      [...desiredScoped.keys()].some((key) => !registeredScoped.has(key)) ||
      [...registeredScoped.keys()].some((key) => !desiredScoped.has(key))
    syncDirty = false
    if (needsResync) scheduleSync()
  }

  return {
    addScoped(ref, deliver, account) {
      // Delivery is by frame key; registration is by frame key + account. On an account switch
      // the old registration leaves and the new one arrives in the same diff, so the POST carries
      // both an unsubscribe and a subscribe of the frame — the server applies unsubscribes first
      // and re-resolves the frame against the (new) session.
      const frameKey = scopedEventKey(ref)
      const registrationKey = scopedRegistrationKey(ref, account)
      let set = subscribers.get(frameKey)
      if (!set) {
        set = new Set()
        subscribers.set(frameKey, set)
      }
      set.add(deliver)
      scopedRefCounts.set(registrationKey, (scopedRefCounts.get(registrationKey) ?? 0) + 1)
      desiredScoped.set(registrationKey, ref)
      scheduleSync()
      return () => {
        set.delete(deliver)
        if (set.size === 0) subscribers.delete(frameKey)
        const remaining = (scopedRefCounts.get(registrationKey) ?? 1) - 1
        if (remaining > 0) {
          scopedRefCounts.set(registrationKey, remaining)
          return
        }
        scopedRefCounts.delete(registrationKey)
        desiredScoped.delete(registrationKey)
        scheduleSync()
      }
    },
    add(fullKey, deliver) {
      let set = subscribers.get(fullKey)
      if (!set) {
        set = new Set()
        subscribers.set(fullKey, set)
      }
      set.add(deliver)
      desired.add(fullKey)
      scheduleSync()
      return () => {
        set.delete(deliver)
        if (set.size === 0) {
          subscribers.delete(fullKey)
          desired.delete(fullKey)
          scheduleSync()
        }
      }
    },
  }
}
