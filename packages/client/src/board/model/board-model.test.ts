import { context } from '@reatom/core'
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  addBoard,
  addInstance,
  expandedInstanceId,
  removeBoard,
  removeInstance,
  updateBoard,
  updateLayout,
} from './board-model'
import { activeBoard, activeBoardId, boards, LOCAL_BOARD_ID, localBoard } from './board-storage'

const resetLocalBoard = () =>
  localBoard.set({
    id: LOCAL_BOARD_ID,
    name: LOCAL_BOARD_ID,
    instances: [],
    layout: [],
  })

beforeEach(() => {
  context.reset()
  localStorage.clear()
  resetLocalBoard()
  boards.set(null)
  activeBoardId.set(LOCAL_BOARD_ID)
})

afterEach(() => localStorage.clear())

describe('board-model', () => {
  it('starts with an empty local board', () => {
    expect(activeBoard()?.instances).toEqual([])
    expect(activeBoard()?.layout).toEqual([])
  })

  it('adds an instance with a layout item sized from the registry', () => {
    addInstance('clock')

    const board = activeBoard()
    expect(board?.instances).toHaveLength(1)
    expect(board?.instances[0]?.typeId).toBe('clock')

    const id = board?.instances[0]?.id
    expect(id).toEqual(expect.any(String))

    const item = board?.layout.find((layoutItem) => layoutItem.i === id)
    expect(item).toMatchObject({ w: 3, h: 4, minW: 2, minH: 2 })
  })

  it('generates a non-empty id when adding an instance', () => {
    addInstance('clock')

    const id = activeBoard()?.instances[0]?.id
    expect(id).toEqual(expect.any(String))
    expect(id?.length).toBeGreaterThan(0)
  })

  it('ignores unknown widget types and keeps the board unchanged', () => {
    addInstance('nope')

    expect(activeBoard()?.instances).toEqual([])
    expect(activeBoard()?.layout).toEqual([])
  })

  it('removes an instance and its layout item', () => {
    addInstance('clock')
    const id = activeBoard()?.instances[0]?.id
    if (!id) throw new Error('expected instance id after addInstance')

    removeInstance(id)

    expect(activeBoard()?.instances).toHaveLength(0)
    expect(activeBoard()?.layout.some((layoutItem) => layoutItem.i === id)).toBe(false)
  })

  it('replaces the layout via updateLayout', () => {
    const next = [{ i: 'x', x: 1, y: 2, w: 3, h: 4, minW: 2, minH: 2 }]

    updateLayout(next)

    expect(activeBoard()?.layout).toEqual(next)
  })

  it('tracks the expanded instance', () => {
    expect(expandedInstanceId()).toBeNull()
    expandedInstanceId.set('abc')
    expect(expandedInstanceId()).toBe('abc')
  })

  it('adds, renames, and removes shared boards', () => {
    addBoard('Главная')

    const created = boards()?.[0]
    expect(created).toMatchObject({
      name: 'Главная',
      instances: [],
      layout: [],
    })
    expect(created?.id).toEqual(expect.any(String))

    if (!created) throw new Error('expected shared board after addBoard')

    updateBoard(created.id, 'Рабочая')
    expect(boards()?.[0]?.name).toBe('Рабочая')

    removeBoard(created.id)
    expect(boards()).toEqual([])
  })
})
