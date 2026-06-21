import { action, atom, effect } from '@reatom/core'

import { findWidgetType } from '@/widget-registry/model/registry'

import { loadBoard, saveBoard } from './board-storage'
import type { LayoutItem, WidgetInstance } from './types'

export const instances = atom<WidgetInstance[]>([], 'board.instances')
export const layout = atom<LayoutItem[]>([], 'board.layout')
export const expandedInstanceId = atom<string | null>(null, 'board.expandedInstanceId')
const boardInitialized = atom(false, 'board.initialized')

function createInstanceId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }

  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))
    return [
      hex.slice(0, 4).join(''),
      hex.slice(4, 6).join(''),
      hex.slice(6, 8).join(''),
      hex.slice(8, 10).join(''),
      hex.slice(10, 16).join(''),
    ].join('-')
  }

  return `instance-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export const addInstance = action((typeId: string) => {
  const type = findWidgetType(typeId)
  if (type instanceof Error) return type

  const id = createInstanceId()
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
