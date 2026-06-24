import { context } from '@reatom/core'
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'

import { activeBoard, activeBoardId, boards, LOCAL_BOARD_ID, localBoard } from './board-storage'

const emptyLocalBoard = {
  id: LOCAL_BOARD_ID,
  name: LOCAL_BOARD_ID,
  instances: [],
  layout: [],
}

beforeEach(() => {
  context.reset()
  localStorage.clear()
  localBoard.set(emptyLocalBoard)
  boards.set(null)
  activeBoardId.set(LOCAL_BOARD_ID)
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
})
