import { LitterSwitcher } from 'module-cats/ui/LitterSwitcher'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import { WidgetControls, type WidgetChrome } from 'widget-sdk/ui/WidgetControls'

import { useOfelia } from '../ofelia-context'
import { Avatar } from '../parts/Avatar'

import styles from './TinyTier.module.css'

export type TinyTierProps = {
  chrome: WidgetChrome
}

// No header row: a title squeezed into 152 px collapses to one letter. The controls float in the
// corner, and with more than one litter a badge in the other corner says which one this is (the
// choice itself is changed from a larger tier).
export const TinyTier = reatomMemo<TinyTierProps>(({ chrome }) => {
  const { view, card } = useOfelia()
  // Reads only the primitive `selectedPerson` → re-renders solely on a name change.
  const person = view.selectedPerson()
  if (!person) return null

  return (
    <div className={styles.root}>
      <WidgetControls placement="overlay" {...chrome} />
      {card.choice.canSwitch() && (
        <span className={styles.badge}>
          <LitterSwitcher choice={card.choice} manage={card.manage} variant="badge" />
        </span>
      )}
      <div className={styles.body}>
        <Avatar person={person} size="lg" />
        <div className={styles.name}>{person}</div>
      </div>
    </div>
  )
}, 'TinyTier')
