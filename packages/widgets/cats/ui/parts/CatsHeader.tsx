import { wrap } from '@reatom/core'
import { PawPrint } from 'lucide-react'
import { CatSwitcher } from 'module-cats/ui/CatSwitcher'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import { WidgetControls, type WidgetChrome } from 'widget-sdk/ui/WidgetControls'

import type { CatsTab } from '@/model/cats-card'

import { useCats } from '../cats-context'
import { dotLine } from './dot-line'

import styles from './CatsHeader.module.css'

const TABS: { id: CatsTab; label: string }[] = [
  { id: 'profile', label: 'Профиль' },
  { id: 'weight', label: 'Вес' },
  { id: 'all', label: 'Все кошки' },
]

export type CatsHeaderProps = { chrome: WidgetChrome }

/**
 * `CatsLarge`'s header: the cat's name over "breed · age", the switcher (only with more than one
 * cat), the tabs "Профиль · Вес · Все кошки", then the card controls — "Закрыть" in fullscreen,
 * "Развернуть" and "Удалить" on the board's large tier.
 */
export const CatsHeader = reatomMemo<CatsHeaderProps>(({ chrome }) => {
  const { card, manage } = useCats()
  const current = card.choice.current()
  const options = card.choice.options()
  const passport = card.view.passport()
  if (current === null || options === null || passport === null) return null
  const tab = card.tab()
  const subtitle = dotLine([passport.breed, passport.ageLong])

  return (
    <div className={styles.header}>
      <div className={styles.identity}>
        <span className={styles.tile} aria-hidden>
          <PawPrint />
        </span>
        <div className={styles.titles}>
          <h2 className={styles.name}>{passport.name}</h2>
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        </div>
        {card.choice.canSwitch() && (
          <CatSwitcher
            kind="cat"
            variant="menu"
            options={options.map((cat) => ({ id: cat.id, label: cat.name, cats: [cat] }))}
            currentId={current.id}
            onChoose={card.choice.choose}
            manage={manage}
          />
        )}
      </div>
      <div className={styles.tabs} role="group" aria-label="Разделы">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className={styles.tab}
            aria-pressed={tab === id}
            onClick={wrap(() => card.tab.set(id))}
          >
            {label}
          </button>
        ))}
      </div>
      <WidgetControls placement="inline" className={styles.controls} {...chrome} />
    </div>
  )
}, 'CatsHeader')
