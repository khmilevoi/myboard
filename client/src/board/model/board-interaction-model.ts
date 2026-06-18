import { action, reatomBoolean } from '@reatom/core'

function setBoardInteractionSelectionGuard(enabled: boolean) {
  if (typeof document === 'undefined') return

  if (enabled) {
    document.body.dataset.boardInteracting = 'true'
  } else {
    delete document.body.dataset.boardInteracting
  }

  window.getSelection()?.removeAllRanges()
}

export const isBoardInteracting = reatomBoolean(false, 'board.isInteracting')

export const beginBoardInteraction = action(() => {
  isBoardInteracting.setTrue()
  setBoardInteractionSelectionGuard(true)
}, 'board.interaction.begin')

export const endBoardInteraction = action(() => {
  isBoardInteracting.setFalse()
  setBoardInteractionSelectionGuard(false)
}, 'board.interaction.end')
