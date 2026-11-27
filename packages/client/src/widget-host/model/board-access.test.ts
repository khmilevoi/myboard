// @vitest-environment jsdom
import { context } from '@reatom/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { expandedInstanceId } from '@/board/model/board-model'
import {
  activeBoard,
  activeBoardId,
  boards,
  LOCAL_BOARD_ID,
  localBoard,
} from '@/board/model/board-storage'

import { makeBoardAccess } from './board-access'

const place = (ids: Array<[string, string]>) =>
  localBoard.set({
    id: LOCAL_BOARD_ID,
    name: LOCAL_BOARD_ID,
    instances: ids.map(([id, typeId]) => ({ id, typeId })),
    layout: [],
  })

beforeEach(() => {
  context.reset()
  localStorage.clear()
  boards.set(null)
  activeBoardId.set(LOCAL_BOARD_ID)
  place([
    ['1', 'clock'],
    ['2', 'cats'],
    ['3', 'cats'],
  ])
})

afterEach(() => localStorage.clear())

describe('makeBoardAccess', () => {
  it('finds the first placed instance of a type, or null', () => {
    const board = makeBoardAccess()

    expect(board.firstInstanceOf('cats')()).toBe('2')
    expect(board.firstInstanceOf('ofelia-stats')()).toBeNull()
  })

  it('follows the board when an instance is removed', () => {
    const board = makeBoardAccess()
    const first = board.firstInstanceOf('cats')
    expect(first()).toBe('2')

    place([
      ['1', 'clock'],
      ['3', 'cats'],
    ])

    expect(activeBoard()?.instances).toHaveLength(2)
    expect(first()).toBe('3')
  })

  it('memoizes one computed per type', () => {
    const board = makeBoardAccess()
    expect(board.firstInstanceOf('cats')).toBe(board.firstInstanceOf('cats'))
  })

  it('expands an instance', () => {
    makeBoardAccess().expand('3')
    expect(expandedInstanceId()).toBe('3')
  })

  it('finds nothing while no board is active', () => {
    activeBoardId.set('remote-board')
    expect(activeBoard()).toBeNull()

    expect(makeBoardAccess().firstInstanceOf('cats')()).toBeNull()
  })

  it('still expands after the context is reset', () => {
    const board = makeBoardAccess()
    context.reset()

    board.expand('2')
    expect(expandedInstanceId()).toBe('2')
  })
})
