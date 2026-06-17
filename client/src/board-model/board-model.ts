import { action, atom, effect } from '@reatom/core'
import { findWidgetType } from '../widget-registry/registry'
import { loadBoard, saveBoard } from './board-storage'
import type { LayoutItem, WidgetInstance } from './types'

export const instances = atom<WidgetInstance[]>([], 'board.instances')
export const layout = atom<LayoutItem[]>([], 'board.layout')
export const expandedInstanceId = atom<string | null>(null, 'board.expandedInstanceId')
const boardInitialized = atom(false, 'board.initialized')

export const addInstance = action((typeId: string) => {
  const type = findWidgetType(typeId)
  if (type instanceof Error) return type

  const id = crypto.randomUUID()
  instances.set((list) => [...list, { id, typeId }])
  layout.set((items) => {
    const nextY = items.reduce((max, item) => Math.max(max, item.y + item.h), 0)
    return [
      ...items,
      {
        i: id,
        x: 0,
        y: nextY,
        w: type.defaultSize.w,
        h: type.defaultSize.h,
        minW: 2,
        minH: 2,
      },
    ]
  })
  return id
}, 'board.addInstance')

export const removeInstance = action((id: string) => {
  instances.set((list) => list.filter((item) => item.id !== id))
  layout.set((items) => items.filter((item) => item.i !== id))
  if (expandedInstanceId() === id) expandedInstanceId.set(null)
}, 'board.removeInstance')

export const updateLayout = action((next: LayoutItem[]) => {
  layout.set(next)
}, 'board.updateLayout')

export const initBoard = action(() => {
  const snapshot = loadBoard()
  if (snapshot instanceof Error) {
    console.warn('Board load failed:', snapshot.message)
    boardInitialized.set(true)
    return
  }
  if (snapshot !== null) {
    instances.set(snapshot.instances)
    layout.set(snapshot.layout)
  }
  boardInitialized.set(true)
}, 'board.init')

effect(() => {
  if (!boardInitialized()) return
  const snapshot = { instances: instances(), layout: layout() }
  const result = saveBoard(snapshot)
  if (result instanceof Error) console.warn('Board save failed:', result.message)
}, 'board.persist')
