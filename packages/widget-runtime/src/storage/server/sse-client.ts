import type { HttpLike } from '@shared/http/client'
import type { EventStream, OpenEventStream } from '@shared/http/event-stream'
import { z } from 'zod'

export type SseDeliver = (rawValue: unknown) => void
export type SseManager = { add(fullKey: string, deliver: SseDeliver): () => void }

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

export function makeSseManager(deps: SseManagerDeps): SseManager {
  const subscribers = new Map<string, Set<SseDeliver>>()
  const desired = new Set<string>()
  let registered = new Set<string>()
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
    registered = new Set() // new connection: server knows nothing yet
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
    if (subscribe.length === 0 && unsubscribe.length === 0) return

    const requestConnId = connId
    const nextRegistered = new Set(desired)
    syncInFlight = true
    const result = await deps.http.post(`${deps.baseUrl}/events/${requestConnId}`, {
      json: { subscribe, unsubscribe },
    })
    syncInFlight = false

    if (connId !== requestConnId) {
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
    const needsResync =
      syncDirty ||
      [...desired].some((key) => !registered.has(key)) ||
      [...registered].some((key) => !desired.has(key))
    syncDirty = false
    if (needsResync) scheduleSync()
  }

  return {
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
