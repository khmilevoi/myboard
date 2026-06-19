import { z } from 'zod'

export type SseDeliver = (rawValue: unknown) => void

type SseManager = { add(fullKey: string, deliver: SseDeliver): () => void }

const managers = new Map<string, SseManager>()

export function getSseManager(baseUrl: string): SseManager {
  let mgr = managers.get(baseUrl)
  if (!mgr) {
    mgr = createSseManager(baseUrl)
    managers.set(baseUrl, mgr)
  }
  return mgr
}

const REGISTER_RETRY_MS = 1_000

const ReadyEventSchema = z.object({
  connId: z.string(),
})

const StorageEventSchema = z.object({
  key: z.string(),
  value: z.unknown(),
})

function parseMessageData(event: MessageEvent): unknown | Error {
  try {
    return JSON.parse(event.data) as unknown
  } catch (cause) {
    return new Error('invalid SSE JSON', { cause })
  }
}

function createSseManager(baseUrl: string): SseManager {
  const subscribers = new Map<string, Set<SseDeliver>>()
  const desired = new Set<string>()
  let registered = new Set<string>()
  let connId: string | undefined
  let syncScheduled = false
  let retryTimer: ReturnType<typeof setTimeout> | undefined

  function scheduleRetry(): void {
    if (retryTimer) return
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      scheduleSync()
    }, REGISTER_RETRY_MS)
  }

  const source = new EventSource(`${baseUrl}/events`)

  source.addEventListener('ready', (event) => {
    const raw = parseMessageData(event as MessageEvent)
    if (raw instanceof Error) {
      console.warn('invalid storage SSE ready frame', raw)
      return
    }
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
  })

  source.onmessage = (event) => {
    const raw = parseMessageData(event)
    if (raw instanceof Error) {
      console.warn('invalid storage SSE message frame', raw)
      return
    }
    const parsed = StorageEventSchema.safeParse(raw)
    if (!parsed.success) {
      console.warn('invalid storage SSE message frame', parsed.error)
      return
    }
    const set = subscribers.get(parsed.data.key)
    if (set) for (const deliver of set) deliver(parsed.data.value)
  }

  function scheduleSync(): void {
    if (syncScheduled) return
    syncScheduled = true
    queueMicrotask(() => {
      syncScheduled = false
      void sync()
    })
  }

  async function sync(): Promise<void> {
    if (!connId) return
    const subscribe = [...desired].filter((key) => !registered.has(key))
    const unsubscribe = [...registered].filter((key) => !desired.has(key))
    if (subscribe.length === 0 && unsubscribe.length === 0) return

    const nextRegistered = new Set(desired)
    const response = await fetch(`${baseUrl}/events/${connId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subscribe, unsubscribe }),
    }).catch((cause) => {
      console.warn('storage SSE registration failed', cause)
      return null
    })

    if (response === null || !response.ok) {
      if (response !== null) {
        console.warn('storage SSE registration failed', response.status)
      }
      scheduleRetry()
      return
    }

    registered = nextRegistered
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
