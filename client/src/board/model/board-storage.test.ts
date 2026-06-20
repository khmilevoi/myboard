// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { JSONParseError } from '@shared/json'
import { loadBoard, saveBoard, STORAGE_KEY, StorageError } from './board-storage'
import type { BoardSnapshot } from './types'

const snapshot: BoardSnapshot = {
  instances: [{ id: 'a', typeId: 'clock' }],
  layout: [{ i: 'a', x: 0, y: 0, w: 3, h: 4 }],
}

afterEach(() => localStorage.clear())

describe('board storage', () => {
  it('returns null when nothing is stored', () => {
    expect(loadBoard()).toBeNull()
  })

  it('round-trips a snapshot', () => {
    const saved = saveBoard(snapshot)
    expect(saved).toBeUndefined()
    expect(loadBoard()).toEqual(snapshot)
  })

  it('returns StorageError for corrupt JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{not json')
    const result = loadBoard()
    expect(result).toBeInstanceOf(StorageError)
    expect(result instanceof StorageError && result.findCause(JSONParseError)).toBeInstanceOf(
      JSONParseError,
    )
  })

  it('returns StorageError when the stored shape is wrong', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ instances: 'nope' }))
    expect(loadBoard()).toBeInstanceOf(StorageError)
  })
})
