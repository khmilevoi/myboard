import { atom, effect } from '@reatom/core'
import { computed } from '@reatom/core'
import z from 'zod'

import { withStorageKey } from '@/storage/model/reatom/reatom-storage'

import { rootStorage } from './storage'
import { BoardSnapshot, BoardSnapshots, BoardSnapshotSchema, BoardSnapshotsShema } from './types'

export const LOCAL_BOARD_ID = 'local'

export const localBoard = atom<BoardSnapshot>(
  {
    id: LOCAL_BOARD_ID,
    name: LOCAL_BOARD_ID,
    instances: [],
    layout: [],
  },
  'board.localBoard',
).extend(
  withStorageKey({ api: rootStorage.client, key: 'localBoard', schema: BoardSnapshotSchema }),
)
export const boards = atom<BoardSnapshots | null>(null, 'board.boards').extend(
  withStorageKey({ api: rootStorage.server, key: 'boards', schema: BoardSnapshotsShema }),
)
export const activeBoardId = atom<string | null>(null, 'board.activeBoard').extend(
  withStorageKey({ api: rootStorage.client, key: 'activeBoardId', schema: z.string() }),
)
export const activeBoard = computed<BoardSnapshot | null>(() => {
  if (activeBoardId() === LOCAL_BOARD_ID) return localBoard()
  return boards()?.find((board) => board.id === activeBoardId()) ?? null
}).extend(() => ({
  update: (
    factory: BoardSnapshot | null | ((state: BoardSnapshot | null) => BoardSnapshot | null),
  ) => {
    const nextState = typeof factory === 'function' ? factory(activeBoard()) : factory

    if (activeBoardId() === LOCAL_BOARD_ID && nextState) return localBoard.set(nextState)

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

  if (boards.isLoading()) return
  if (!boardsValue) return activeBoardId.set(LOCAL_BOARD_ID)
  if (boardsValue.length === 0) return
  if (activeBoardId()) return

  activeBoardId.set(boardsValue[0].id)
})
