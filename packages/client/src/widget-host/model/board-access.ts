import { computed, type AtomLike } from '@reatom/core'
import type { WidgetBoardAccess } from 'widget-runtime'

import { expandedInstanceId } from '@/board/model/board-model'
import { activeBoard } from '@/board/model/board-storage'

export const makeBoardAccess = (): WidgetBoardAccess => {
  const byType = new Map<string, AtomLike<string | null>>()

  return {
    firstInstanceOf: (typeId) => {
      const cached = byType.get(typeId)
      if (cached) return cached
      const first = computed(
        () => activeBoard()?.instances.find((instance) => instance.typeId === typeId)?.id ?? null,
        `boardAccess.firstInstanceOf.${typeId}`,
      )
      byType.set(typeId, first)
      return first
    },
    // Plain, not a hoisted `wrap()`: that closure would abort after a context reset. Callers wrap
    // their event handlers per call.
    expand: (instanceId) => {
      expandedInstanceId.set(instanceId)
    },
  }
}
