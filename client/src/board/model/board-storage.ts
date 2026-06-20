import * as errore from 'errore'
import { JSONParseError, safeParse } from '@shared/json'
import type { BoardSnapshot } from './types'

export const STORAGE_KEY = 'myboard.board'

export class StorageError extends errore.createTaggedError({
  name: 'StorageError',
  message: 'Storage operation failed: $reason',
}) {}

function isSnapshot(value: unknown): value is BoardSnapshot {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return Array.isArray(record.instances) && Array.isArray(record.layout)
}

export function loadBoard(): StorageError | BoardSnapshot | null {
  const raw = errore.try({
    try: () => localStorage.getItem(STORAGE_KEY),
    catch: (cause) => new StorageError({ reason: 'read failed', cause }),
  })
  if (raw instanceof StorageError) return raw
  if (raw === null) return null

  const parsed = safeParse(raw)
  if (parsed instanceof JSONParseError) {
    return new StorageError({ reason: 'invalid JSON', cause: parsed })
  }
  if (!isSnapshot(parsed)) return new StorageError({ reason: 'stored value has wrong shape' })

  return parsed
}

export function saveBoard(snapshot: BoardSnapshot): StorageError | void {
  const result = errore.try({
    try: () => localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)),
    catch: (cause) => new StorageError({ reason: 'write failed', cause }),
  })
  if (result instanceof StorageError) return result
}
