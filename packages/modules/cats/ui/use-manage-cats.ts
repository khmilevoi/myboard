import { atom, wrap } from '@reatom/core'
import { useMemo } from 'react'
import { useWidgetContext } from 'widget-runtime'
import { useAtomValue } from 'widget-sdk/reatom/use-atom-value'

import type { CatSwitcherManage } from './CatSwitcher'

/** The "Кошки" widget's id: its directory under `packages/widgets/`. */
export const CATS_WIDGET_ID = 'cats'

/** Read when the host offers no board access (a standalone harness): no card is ever placed. */
const NO_BOARD = atom<string | null>(null, 'manageCats.noBoard')

/**
 * What a cat switcher offers below its options: "Управлять кошками →" opening the first placed
 * "Кошки" card fullscreen, or, with none placed (or no board at all), the hint to add one.
 */
export function useManageCats(): CatSwitcherManage {
  const { board } = useWidgetContext()
  const instanceId = useAtomValue(board?.firstInstanceOf(CATS_WIDGET_ID) ?? NO_BOARD)

  return useMemo((): CatSwitcherManage => {
    if (!board || instanceId === null) return { kind: 'hint' }
    // Wrapped per call, not once: a closure wrapped at render keeps the root it was made in.
    return { kind: 'open', onOpen: () => wrap(() => board.expand(instanceId))() }
  }, [board, instanceId])
}
