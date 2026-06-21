import { context } from '@reatom/core'
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  instances,
  layout,
  expandedInstanceId,
  addInstance,
  removeInstance,
  updateLayout,
  initBoard,
} from './board-model'
import { saveBoard } from './board-storage'

beforeEach(() => {
  context.reset()
  localStorage.clear()
})

afterEach(() => localStorage.clear())

describe('board-model', () => {
  it('starts empty', () => {
    expect(instances()).toEqual([])
    expect(layout()).toEqual([])
  })

  it('adds an instance with a layout item sized from the registry', () => {
    const id = addInstance('clock')
    if (id instanceof Error) throw id

    expect(instances()).toHaveLength(1)
    expect(instances()[0]).toMatchObject({ id, typeId: 'clock' })

    const item = layout().find((layoutItem) => layoutItem.i === id)
    expect(item).toMatchObject({ w: 3, h: 4 })
  })

  it('adds an instance when crypto.randomUUID is unavailable', () => {
    const originalRandomUUID = globalThis.crypto.randomUUID
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      configurable: true,
      value: undefined,
    })

    try {
      const id = addInstance('clock')
      if (id instanceof Error) throw id

      expect(id).toEqual(expect.any(String))
      expect(id.length).toBeGreaterThan(0)
      expect(instances()[0]).toMatchObject({ id, typeId: 'clock' })
      expect(layout()[0]?.i).toBe(id)
    } finally {
      Object.defineProperty(globalThis.crypto, 'randomUUID', {
        configurable: true,
        value: originalRandomUUID,
      })
    }
  })

  it('returns an error when adding an unknown type', () => {
    const result = addInstance('nope')
    expect(result).toBeInstanceOf(Error)
    expect(instances()).toHaveLength(0)
  })

  it('removes an instance and its layout item', () => {
    const id = addInstance('clock')
    if (id instanceof Error) throw id
    removeInstance(id)
    expect(instances()).toHaveLength(0)
    expect(layout().some((layoutItem) => layoutItem.i === id)).toBe(false)
  })

  it('replaces the layout via updateLayout', () => {
    const next = [{ i: 'x', x: 1, y: 2, w: 3, h: 4 }]
    updateLayout(next)
    expect(layout()).toEqual(next)
  })

  it('tracks the expanded instance', () => {
    expect(expandedInstanceId()).toBeNull()
    expandedInstanceId.set('abc')
    expect(expandedInstanceId()).toBe('abc')
  })

  it('restores a persisted snapshot during initBoard without clobbering storage first', () => {
    const snapshot = {
      instances: [{ id: 'persisted', typeId: 'clock' }],
      layout: [{ i: 'persisted', x: 0, y: 0, w: 3, h: 2 }],
    }
    const saved = saveBoard(snapshot)
    if (saved instanceof Error) throw saved

    initBoard()

    expect(instances()).toEqual(snapshot.instances)
    expect(layout()).toEqual(snapshot.layout)
  })
})
