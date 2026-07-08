export type StorageDeliver = (rawValue: unknown) => void
export type ChannelMessage = { fullKey: string; value: unknown }
export type BroadcastChannelLike = Pick<
  BroadcastChannel,
  'postMessage' | 'addEventListener' | 'close'
>

const CHANNEL_NAME = 'myboard-storage'

export function makeChannelHub(makeChannel: (name: string) => BroadcastChannelLike) {
  const subscribers = new Map<string, Set<StorageDeliver>>()

  let channel: BroadcastChannelLike | undefined
  let listening = false

  function getStorageChannel(): BroadcastChannelLike {
    if (!channel) channel = makeChannel(CHANNEL_NAME)
    return channel
  }

  function notifyLocal(fullKey: string, rawValue: unknown): void {
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
  function registerLocal(fullKey: string, deliver: StorageDeliver): () => void {
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
  function publishChange(fullKey: string, value: unknown): void {
    notifyLocal(fullKey, value)
    getStorageChannel().postMessage({ fullKey, value } satisfies ChannelMessage)
  }

  return { registerLocal, publishChange, notifyLocal }
}

/**
 * Per-document module hub — deliberate module state, like client/db.ts: the
 * BroadcastChannel fans key changes out to OTHER tabs, so one hub per
 * document is the correct cardinality. Tests build their own hubs.
 */
const hub = makeChannelHub((name) => new BroadcastChannel(name))
export const registerLocal = hub.registerLocal
export const publishChange = hub.publishChange
export const notifyLocal = hub.notifyLocal
