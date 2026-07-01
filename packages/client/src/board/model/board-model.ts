import { action, atom } from '@reatom/core'
import { nanoid } from 'nanoid'

import { findWidgetType, WidgetType } from '@/widget-registry/model/registry'

import { activeBoard, boards } from './board-storage'
import { BoardSnapshot, type LayoutItem } from './types'

export const expandedInstanceId = atom<string | null>(null, 'board.expandedInstanceId')

export const addBoard = action((name: string) => {
  boards.set((snapshots) => {
    const nextSnapshot: BoardSnapshot = {
      id: nanoid(),
      name,
      instances: [],
      layout: [],
    }

    if (!snapshots) return [nextSnapshot]
    return [nextSnapshot, ...snapshots]
  })
})

export const updateBoard = action((id: string, name: string) => {
  boards.set((snapshots) => {
    if (!snapshots) return snapshots
    return snapshots.map((snapshot) => {
      if (snapshot.id === id) return { ...snapshot, name }
      return snapshot
    })
  })
})

export const removeBoard = action((id: string) => {
  boards.set((snapshots) => {
    if (!snapshots) return snapshots
    return snapshots.filter((snapshot) => snapshot.id !== id)
  })
})

export const addInstance = action((typeId: string) => {
  const active = activeBoard()
  if (!active) return

  const type = findWidgetType(typeId)
  if (type instanceof Error) return type

  const id = nanoid()

  activeBoard.update((active) => {
    if (!active) return active
    const nextY = active.layout.reduce((max, item) => Math.max(max, item.y + item.h), 0)

    return {
      ...active,
      instances: [{ id, typeId }, ...active.instances],
      layout: [makeLayout(id, nextY, type.defaultSize), ...active.layout],
    }
  })
}, 'board.addInstance')

export const makeLayout = (
  id: string,
  y: number,
  defaultSize: WidgetType['defaultSize'],
): LayoutItem => ({
  i: id,
  x: 0,
  y,
  w: defaultSize.w,
  h: defaultSize.h,
  minW: defaultSize.minW,
  minH: defaultSize.minH,
})

export const removeInstance = action((id: string) => {
  activeBoard.update((active) => {
    if (!active) return active
    return {
      ...active,
      instances: active.instances.filter((instance) => instance.id !== id),
      layout: active.layout.filter((item) => item.i !== id),
    }
  })
}, 'board.removeInstance')

export const updateLayout = action((next: LayoutItem[]) => {
  activeBoard.update((active) => {
    if (!active) return active
    return {
      ...active,
      layout: next,
    }
  })
}, 'board.updateLayout')
