import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { StorageError, type StorageListener } from './types'
import { subscribeStorageKey } from './subscribe-key'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('subscribeStorageKey', () => {
  it('emits the initial value when no live change arrives first', async () => {
    const initial = deferred<StorageError | number | null>()
    const seen: unknown[] = []
    subscribeStorageKey({
      getCurrent: () => initial.promise,
      register: () => () => {},
      listener: (event) => seen.push(event instanceof Error ? event : event.value),
    })

    initial.resolve(1)
    await vi.waitFor(() => expect(seen).toEqual([1]))
  })

  it('does not let a delayed initial value overwrite a newer live change', async () => {
    const initial = deferred<StorageError | number | null>()
    let live!: (raw: unknown) => void
    const seen: unknown[] = []
    subscribeStorageKey({
      getCurrent: () => initial.promise,
      register: (deliver) => {
        live = deliver
        return () => {}
      },
      listener: (event) => seen.push(event instanceof Error ? event : event.value),
    })

    live(2)
    initial.resolve(1)
    await vi.waitFor(() => expect(seen).toEqual([2]))
  })

  it('does not emit after unsubscribe, including delayed initial reads', async () => {
    const initial = deferred<StorageError | number | null>()
    const unregister = vi.fn()
    const seen: unknown[] = []
    const off = subscribeStorageKey({
      getCurrent: () => initial.promise,
      register: () => unregister,
      listener: (event) => seen.push(event instanceof Error ? event : event.value),
    })

    off()
    initial.resolve(1)
    await Promise.resolve()
    expect(unregister).toHaveBeenCalledOnce()
    expect(seen).toEqual([])
  })

  it('validates live raw values through the schema', () => {
    let live!: (raw: unknown) => void
    const events: Array<StorageError | { value: { text: string } | null }> = []
    const listener: StorageListener<{ text: string }> = (event) => events.push(event)
    subscribeStorageKey({
      getCurrent: async () => null,
      register: (deliver) => {
        live = deliver
        return () => {}
      },
      listener,
      schema: z.object({ text: z.string() }),
    })

    live({ text: 123 })
    expect(events[0]).toBeInstanceOf(StorageError)
  })
})
