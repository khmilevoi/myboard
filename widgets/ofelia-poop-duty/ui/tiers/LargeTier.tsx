import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import { RichLayout } from '../parts/RichLayout'

export type LargeTierProps = {
  onExpand?: () => void
  onDelete?: () => void
}

export const LargeTier = reatomMemo<LargeTierProps>(({ onExpand, onDelete }) => {
  return <RichLayout onExpand={onExpand} onDelete={onDelete} />
}, 'LargeTier')
