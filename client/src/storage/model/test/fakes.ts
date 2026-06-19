import { vi } from 'vitest'

/** In-memory BroadcastChannel: instances with the same name see each other's posts. */
export class FakeBroadcastChannel {
  static channels = new Map<string, Set<FakeBroadcastChannel>>()
  onmessage: ((event: MessageEvent) => void) | null = null
  private listeners = new Set<(event: MessageEvent) => void>()

  constructor(public name: string) {
    const peers = FakeBroadcastChannel.channels.get(name) ?? new Set()
    peers.add(this)
    FakeBroadcastChannel.channels.set(name, peers)
  }

  addEventListener(_type: 'message', listener: (event: MessageEvent) => void) {
    this.listeners.add(listener)
  }

  removeEventListener(_type: 'message', listener: (event: MessageEvent) => void) {
    this.listeners.delete(listener)
  }

  postMessage(data: unknown) {
    const peers = FakeBroadcastChannel.channels.get(this.name) ?? new Set()
    for (const peer of peers) {
      if (peer === this) continue // real BroadcastChannel does not echo to sender
      const event = { data } as MessageEvent
      peer.onmessage?.(event)
      for (const listener of peer.listeners) listener(event)
    }
  }

  close() {
    FakeBroadcastChannel.channels.get(this.name)?.delete(this)
  }
}

export function installFakeBroadcastChannel() {
  FakeBroadcastChannel.channels.clear()
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
}
