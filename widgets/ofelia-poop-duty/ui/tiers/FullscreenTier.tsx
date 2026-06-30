import { reatomMemo } from '@/shared/reatom/reatom-memo'

import { RichLayout } from '../parts/RichLayout'

export type FullscreenTierProps = {
  onClose: () => void
}

export const FullscreenTier = reatomMemo<FullscreenTierProps>(({ onClose }) => {
  return <RichLayout onClose={onClose} />
}, 'FullscreenTier')
