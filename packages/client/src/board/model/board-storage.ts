import { atom, effect } from '@reatom/core'
import { computed } from '@reatom/core'
import { withStorageKey } from 'widget-runtime'
import z from 'zod'

import { rootStorage } from '../storage'
import { migrateBoardLayoutHeights } from './mobile-layout'
import {
  BoardMigrations,
  BoardMigrationsSchema,
  BoardSnapshot,
  BoardSnapshots,
  BoardSnapshotSchema,
  BoardSnapshotsShema,
} from './types'

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
      else if (prevBoards && nextState) {
        const hasActiveBoard = prevBoards.some((board) => board.id === activeBoardId())
        if (!hasActiveBoard) return [...prevBoards, nextState]
        return prevBoards.map((board) => (board.id === activeBoardId() ? nextState : board))
      } else if (prevBoards && !nextState)
        return prevBoards.filter((board) => board.id !== activeBoardId())
      else return prevBoards
    })
  },
}))

export const selectInitialActiveBoard = effect(() => {
  const activeId = activeBoardId()
  const boardsValue = boards()

  if (activeBoardId.isLoading()) return
  if (boards.isLoading()) return
  if (activeId) return
  if (!boardsValue) return activeBoardId.set(LOCAL_BOARD_ID)
  if (boardsValue.length === 0) return activeBoardId.set(LOCAL_BOARD_ID)

  activeBoardId.set(boardsValue[0].id)
}, 'board.selectInitialActiveBoard')

/**
 * Applied one-shot migration ids per board (see BoardMigrations in types.ts).
 * Deliberately its own root:-scoped key rather than a field on the board
 * snapshot itself: BoardSnapshotSchema is loose so an old bundle's
 * write-back preserves fields it doesn't recognise, but that only holds
 * until a client old enough to predate the field *entirely* does the same
 * round trip through main's strict schema — exactly the population this
 * release has to survive. A bundle that never shipped this key never reads
 * or writes it, so it can't strip it.
 *
 * localBoardMigrations mirrors localBoard: per-device client (Dexie)
 * storage, keyed the same way (by board id, LOCAL_BOARD_ID for the local
 * board) for symmetry with sharedBoardMigrations even though it only ever
 * holds one entry.
 */
export const localBoardMigrations = atom<BoardMigrations>({}, 'board.localBoardMigrations').extend(
  withStorageKey({
    api: rootStorage.client,
    key: 'localBoardMigrations',
    schema: BoardMigrationsSchema,
  }),
)

/** Same as localBoardMigrations, mirroring `boards`: shared server-backed storage, keyed by board id. */
export const sharedBoardMigrations = atom<BoardMigrations>(
  {},
  'board.sharedBoardMigrations',
).extend(
  withStorageKey({
    api: rootStorage.server,
    key: 'boardMigrations',
    schema: BoardMigrationsSchema,
  }),
)

/**
 * Applies migrateBoardLayoutHeights to the local board once it and its
 * applied-migrations marker have loaded from client storage, and writes back
 * whichever of the board / marker actually changed. migrateBoardLayoutHeights
 * is idempotent and returns both inputs by the same reference once the
 * marker is present, so this only ever writes once per board — the re-run
 * triggered by that write itself is a no-op and does not loop.
 */
export const migrateLocalBoardHeights = effect(() => {
  if (localBoard.isLoading()) return
  if (localBoardMigrations.isLoading()) return

  const current = localBoard()
  const appliedIds = localBoardMigrations()[LOCAL_BOARD_ID] ?? []
  const { board: migrated, appliedMigrationIds } = migrateBoardLayoutHeights(current, appliedIds)

  if (migrated !== current) localBoard.set(migrated)
  if (appliedMigrationIds !== appliedIds) {
    localBoardMigrations.set((prev) => ({ ...prev, [LOCAL_BOARD_ID]: appliedMigrationIds }))
  }
}, 'board.migrateLocalBoardHeights')

/** Same one-shot migration as migrateLocalBoardHeights, for every shared board. */
export const migrateSharedBoardHeights = effect(() => {
  if (boards.isLoading()) return
  if (sharedBoardMigrations.isLoading()) return

  const current = boards()
  if (!current) return

  const appliedByBoard = sharedBoardMigrations()
  let boardsChanged = false
  let migrationsChanged = false
  const nextMigrations: BoardMigrations = { ...appliedByBoard }

  const migratedBoards = current.map((board) => {
    const appliedIds = appliedByBoard[board.id] ?? []
    const { board: nextBoard, appliedMigrationIds } = migrateBoardLayoutHeights(board, appliedIds)
    if (nextBoard !== board) boardsChanged = true
    if (appliedMigrationIds !== appliedIds) {
      migrationsChanged = true
      nextMigrations[board.id] = appliedMigrationIds
    }
    return nextBoard
  })

  if (boardsChanged) boards.set(migratedBoards)
  if (migrationsChanged) sharedBoardMigrations.set(nextMigrations)
}, 'board.migrateSharedBoardHeights')
