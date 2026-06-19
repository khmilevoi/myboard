export type StorageDeliver = (rawValue: unknown) => void
export type ChannelMessage = { fullKey: string; value: unknown }

const CHANNEL_NAME = 'myboard-storage'
const subscribers = new Map<string, Set<StorageDeliver>>()

let channel: BroadcastChannel | undefined
let listening = false

export function getStorageChannel(): BroadcastChannel {
  if (!channel) channel = new BroadcastChannel(CHANNEL_NAME)
  return channel
}

export function notifyLocal(fullKey: string, rawValue: unknown): void {
  const set = subscribers.get(fullKey)
  if (!set) return
  for (const deliver of set) deliver(rawValue)
}

function ensureChannelListener(): void {
  if (listening) return
  listening = true
  getStorageChannel().addEventListener('message', (event) => {
    const message = (event as MessageEvent<ChannelMessage>).data
    notifyLocal(message.fullKey, message.value)
  })
}

/** Register a delivery callback for a full key. Returns an unsubscribe function. */
export function registerLocal(fullKey: string, deliver: StorageDeliver): () => void {
  ensureChannelListener()
  let set = subscribers.get(fullKey)
  if (!set) {
    set = new Set()
    subscribers.set(fullKey, set)
  }
  set.add(deliver)
  return () => {
    set.delete(deliver)
    if (set.size === 0) subscribers.delete(fullKey)
  }
}

/** Notify same-runtime subscribers and broadcast to other tabs/iframes. */
export function publishChange(fullKey: string, value: unknown): void {
  notifyLocal(fullKey, value)
  getStorageChannel().postMessage({ fullKey, value } satisfies ChannelMessage)
}
