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

function createSseManager(baseUrl: string): SseManager {
  const subscribers = new Map<string, Set<SseDeliver>>()
  const desired = new Set<string>()
  let registered = new Set<string>()
  let connId: string | undefined
  let syncScheduled = false

  const source = new EventSource(`${baseUrl}/events`)

  source.addEventListener('ready', (event) => {
    connId = JSON.parse((event as MessageEvent).data).connId
    registered = new Set() // new connection: server knows nothing yet
    scheduleSync()
  })

  source.onmessage = (event) => {
    const message = JSON.parse((event as MessageEvent).data) as { key: string; value: unknown }
    const set = subscribers.get(message.key)
    if (set) for (const deliver of set) deliver(message.value)
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
    registered = new Set(desired)
    await fetch(`${baseUrl}/events/${connId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subscribe, unsubscribe }),
    }).catch(() => {
      registered = new Set() // force a resync on the next tick if the POST failed
    })
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
