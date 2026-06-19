import type { z } from 'zod'
import type { StorageError, StorageListener } from './types'
import { parseValue } from './validate'

export type SubscribeStorageKeyOptions<T> = {
  getCurrent: () => Promise<StorageError | T | null>
  register: (deliver: (raw: unknown) => void) => () => void
  listener: StorageListener<T>
  schema?: z.ZodType<T>
}

export function subscribeStorageKey<T>({
  getCurrent,
  register,
  listener,
  schema,
}: SubscribeStorageKeyOptions<T>): () => void {
  let active = true
  let liveVersion = 0

  const emit: StorageListener<T> = (event) => {
    if (!active) return
    listener(event)
  }

  const unregister = register((raw) => {
    liveVersion += 1
    if (raw === null) return emit({ value: null })
    const parsed = parseValue(schema, raw)
    emit(parsed instanceof Error ? parsed : { value: parsed })
  })

  const initialVersion = liveVersion
  void getCurrent().then((current) => {
    if (!active || liveVersion !== initialVersion) return
    if (current instanceof Error) return emit(current)
    emit({ value: current })
  })

  return () => {
    active = false
    unregister()
  }
}
