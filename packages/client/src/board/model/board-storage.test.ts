// @vitest-environment node
import 'fake-indexeddb/auto'
import { context, schedule } from '@reatom/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  activeBoard,
  activeBoardId,
  boards,
  LOCAL_BOARD_ID,
  localBoard,
  selectInitialActiveBoard,
} from './board-storage'

const emptyLocalBoard = {
  id: LOCAL_BOARD_ID,
  name: LOCAL_BOARD_ID,
  instances: [],
  layout: [],
}

const markStorageLoaded = () => {
  boards.isLoading.set(false)
  activeBoardId.isLoading.set(false)
}

let unsubscribeSelectInitialActiveBoard = () => {}

beforeEach(() => {
  context.reset()
  unsubscribeSelectInitialActiveBoard = selectInitialActiveBoard.subscribe()
  localBoard.set(emptyLocalBoard)
  boards.set(null)
  activeBoardId.set(LOCAL_BOARD_ID)
})

afterEach(() => {
  unsubscribeSelectInitialActiveBoard()
})

describe('board storage', () => {
  it('resolves the local board when the local id is active', () => {
    expect(activeBoard()).toEqual(emptyLocalBoard)
  })

  it('resolves the selected shared board from the boards list', () => {
    boards.set([
      { id: 'main', name: 'Главная', instances: [], layout: [] },
      { id: 'work', name: 'Рабочая', instances: [], layout: [] },
    ])
    activeBoardId.set('work')

    expect(activeBoard()).toMatchObject({ id: 'work', name: 'Рабочая' })
  })

  it('updates the local board through activeBoard.update', () => {
    activeBoard.update((board) => {
      if (!board) return board
      return {
        ...board,
        instances: [{ id: 'clock-1', typeId: 'clock' }],
      }
    })

    expect(localBoard().instances).toEqual([{ id: 'clock-1', typeId: 'clock' }])
    expect(activeBoard()?.instances).toEqual([{ id: 'clock-1', typeId: 'clock' }])
  })

  it('updates the selected shared board through activeBoard.update', () => {
    boards.set([
      { id: 'main', name: 'Главная', instances: [], layout: [] },
      { id: 'work', name: 'Рабочая', instances: [], layout: [] },
    ])
    activeBoardId.set('main')

    activeBoard.update((board) => {
      if (!board) return board
      return {
        ...board,
        name: 'Главная 2',
      }
    })

    expect(boards()?.find((board) => board.id === 'main')?.name).toBe('Главная 2')
    expect(activeBoard()?.name).toBe('Главная 2')
  })

  it('removes the selected shared board when activeBoard.update receives null', () => {
    boards.set([
      { id: 'main', name: 'Главная', instances: [], layout: [] },
      { id: 'work', name: 'Рабочая', instances: [], layout: [] },
    ])
    activeBoardId.set('work')

    activeBoard.update(null)

    expect(boards()).toEqual([{ id: 'main', name: 'Главная', instances: [], layout: [] }])
    expect(activeBoard()).toBeNull()
  })

  it('falls back to the local board when the shared boards list is empty after loading', async () => {
    markStorageLoaded()
    activeBoardId.set(null)
    boards.set([])

    await vi.waitFor(() => expect(activeBoardId()).toBe(LOCAL_BOARD_ID))
    expect(activeBoard()).toEqual(emptyLocalBoard)
  })

  it('waits for the stored active board id before applying a fallback', async () => {
    boards.isLoading.set(false)
    activeBoardId.isLoading.set(true)
    activeBoardId.set(null)
    boards.set([])

    await schedule(() => undefined)
    expect(activeBoardId()).toBeNull()
  })

  it('keeps the restored active board id when boards load first', async () => {
    boards.isLoading.set(false)
    activeBoardId.isLoading.set(true)
    activeBoardId.set(null)
    boards.set([
      { id: 'main', name: 'Главная', instances: [], layout: [] },
      { id: 'work', name: 'Рабочая', instances: [], layout: [] },
    ])

    await schedule(() => undefined)
    expect(activeBoardId()).toBeNull()

    activeBoardId.set('work')
    activeBoardId.isLoading.set(false)

    await vi.waitFor(() => expect(activeBoardId()).toBe('work'))
    expect(activeBoard()).toMatchObject({ id: 'work', name: 'Рабочая' })
  })

  it('adds a selected shared board through activeBoard.update when the id is missing', () => {
    boards.set([{ id: 'main', name: 'Главная', instances: [], layout: [] }])
    activeBoardId.set('work')

    activeBoard.update({ id: 'work', name: 'Рабочая', instances: [], layout: [] })

    expect(boards()).toEqual([
      { id: 'main', name: 'Главная', instances: [], layout: [] },
      { id: 'work', name: 'Рабочая', instances: [], layout: [] },
    ])
    expect(activeBoard()).toMatchObject({ id: 'work', name: 'Рабочая' })
  })
})
