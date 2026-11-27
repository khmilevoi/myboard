import { Cat } from 'lucide-react'
import { CatCardHeader } from 'module-cats/ui/CatCardHeader'
import { LitterSwitcher } from 'module-cats/ui/LitterSwitcher'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import type { WidgetChrome } from 'widget-sdk/ui/WidgetControls'

import { selectedDaySubtitle } from '../format'
import { useOfelia } from '../ofelia-context'
import { ActionButtons } from '../parts/ActionButtons'
import { ActionErrorNote } from '../parts/ActionErrorNote'
import { Avatar } from '../parts/Avatar'

import styles from './CompactTier.module.css'

export type CompactTierProps = {
  chrome: WidgetChrome
}

export const CompactTier = reatomMemo<CompactTierProps>(({ chrome }) => {
  const { view, actions, card } = useOfelia()
  const selected = view.selected()
  if (!selected) return null

  const balance = view.balance()
  const canForgive = view.canForgive()
  const subtitle = selectedDaySubtitle(selected, balance)
  const actionPending = view.actionPending()
  const actionErrorMessage = view.actionErrorMessage()
  const current = card.choice.current()
  // Page 05, frame B: a shared litter's stack leaves a 268 px card too little room for the icon as
  // well, so the header drops it and "Лоток · Офелия и Буся" reads whole on two lines.
  const stacked = (current?.cats.length ?? 0) > 1

  return (
    <div className={styles.root}>
      <CatCardHeader
        icon={stacked ? null : <Cat aria-hidden />}
        title={current?.title ?? 'Лоток'}
        switcher={<LitterSwitcher choice={card.choice} manage={card.manage} variant="menu" />}
        chrome={chrome}
      />
      <div className={styles.hero}>
        <Avatar person={selected.person} size="md" />
        <div className={styles.copy}>
          <div className={styles.name}>{selected.person}</div>
          <div className={styles.sub}>{subtitle}</div>
        </div>
      </div>

      {selected.isFuture ? null : (
        <>
          <ActionButtons
            className={styles.actions}
            status={selected.status}
            canUndo={selected.canUndo}
            canForgive={canForgive}
            inactive={actionPending}
            debtLabel="Отложить"
            forgiveLabel="Простить"
            onConfirm={actions.onConfirm}
            onUndo={actions.onUndo}
            onDebt={actions.onDebt}
            onForgive={actions.onForgive}
          />
          <ActionErrorNote message={actionErrorMessage} />
        </>
      )}
    </div>
  )
}, 'CompactTier')
