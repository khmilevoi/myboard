import { reatomBoolean, withChangeHook } from '@reatom/core'

export const isBoardInteracting = reatomBoolean(false, 'board.isInteracting').extend(
  withChangeHook((nextState) => {
    if (typeof document === 'undefined') return

    if (nextState) {
      document.body.dataset.boardInteracting = 'true'
    } else {
      delete document.body.dataset.boardInteracting
    }

    window.getSelection()?.removeAllRanges()
  }),
)
