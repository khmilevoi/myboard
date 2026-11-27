import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import type { WidgetChrome } from 'widget-sdk/ui/WidgetControls'

import { RichLayout } from '../parts/RichLayout'

export type LargeTierProps = {
  chrome: WidgetChrome
}

export const LargeTier = reatomMemo<LargeTierProps>(({ chrome }) => {
  return <RichLayout chrome={chrome} />
}, 'LargeTier')
