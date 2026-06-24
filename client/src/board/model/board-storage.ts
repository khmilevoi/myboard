import { atom, effect } from '@reatom/core'
import { computed } from '@reatom/core'
import z from 'zod'

import { withStorageKey } from '@/storage/model/reatom/reatom-storage'

import { rootStorage } from './storage'
import { BoardSnapshot, BoardSnapshots, BoardSnapshotsShema } from './types'

export const boards = atom<BoardSnapshots | null>(null).extend(
  withStorageKey({ api: rootStorage.server, key: 'boardSchemas', schema: BoardSnapshotsShema }),
)
export const activeBoardId = atom<string | null>(null, 'board.activeBoard').extend(
  withStorageKey({ api: rootStorage.client, key: 'activeBoardId', schema: z.string() }),
)
export const activeBoard = computed<BoardSnapshot | null>(() => {
  return boards()?.find((board) => board.id === activeBoardId()) ?? null
}).extend(() => ({
  update: (
    factory: BoardSnapshot | null | ((state: BoardSnapshot | null) => BoardSnapshot | null),
  ) => {
    const nextState = typeof factory === 'function' ? factory(activeBoard()) : factory

    return boards.set((prevBoards) => {
      if (!prevBoards && nextState) return [nextState]
      else if (prevBoards && nextState)
        return prevBoards.map((board) => (board.id === activeBoardId() ? nextState : board))
      else if (prevBoards && !nextState)
        return prevBoards.filter((board) => board.id !== activeBoardId())
      else return prevBoards
    })
  },
}))

effect(() => {
  const boardsValue = boards()

  if (!boardsValue || boardsValue.length === 0) return
  if (activeBoardId()) return

  activeBoardId.set(boardsValue[0].id)
})
