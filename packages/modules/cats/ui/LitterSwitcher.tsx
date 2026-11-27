import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import type { LitterCardChoice } from '../model/card-choice'
import { CatSwitcher, type CatSwitcherManage } from './CatSwitcher'

export type LitterSwitcherProps = {
  choice: LitterCardChoice
  manage: CatSwitcherManage
  /** `menu` in a card header; `badge` is the tiny tier's corner mark. */
  variant: 'menu' | 'badge'
}

/**
 * The litter switcher of a litter card (`ofelia-poop-duty`, `ofelia-stats`): its offered litters,
 * each drawn as the stack of the cats that share it, and the card's current one. Nothing while the
 * choice is still loading.
 */
export const LitterSwitcher = reatomMemo<LitterSwitcherProps>(({ choice, manage, variant }) => {
  const options = choice.options()
  const current = choice.current()
  if (!options || !current) return null

  return (
    <CatSwitcher
      kind="litter"
      variant={variant}
      options={options.map(({ id, title, cats }) => ({ id, label: title, cats }))}
      currentId={current.id}
      onChoose={choice.choose}
      manage={manage}
    />
  )
}, 'LitterSwitcher')
