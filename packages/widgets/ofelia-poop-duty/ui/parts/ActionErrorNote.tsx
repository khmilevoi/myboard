import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import styles from './ActionErrorNote.module.css'

export type ActionErrorNoteProps = {
  message: string | null
}

// F6a: every day action (confirm/debt/forgive/undo) used to fail floating —
// nothing read `.error()`, so a rejected tap looked identical to a
// successful one. This is the shared "last error" affordance the tiers
// render next to the day's action buttons.
export const ActionErrorNote = reatomMemo<ActionErrorNoteProps>(({ message }) => {
  if (!message) return null

  return (
    <p className={styles.root} role="alert">
      {message}
    </p>
  )
}, 'ActionErrorNote')
