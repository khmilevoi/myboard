import { reatomMemo } from '@/shared/reatom/reatom-memo'

import { RichLayout } from '../parts/RichLayout'

export const LargeTier = reatomMemo(() => {
  return <RichLayout />
}, 'LargeTier')
