import { Box } from 'lucide-react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import { WidgetControls } from 'widget-sdk/ui/WidgetControls'

import { Skeleton } from '@/components/ui/skeleton'
import {
  WIDGET_ICONS,
  type WidgetIconName,
  type WidgetType,
} from '@/widget-registry/model/registry'

import styles from './WidgetLoadingCard.module.css'

export type WidgetLoadingCardProps = {
  type: WidgetType
  onDelete?: () => void
}

/**
 * What a board card shows while its widget's remote chunk is still in flight.
 *
 * Two things it does that a bare shimmer could not. It names itself: the host
 * already knows the widget's title and icon synchronously from the codegen
 * catalog, long before a byte of the remote has landed, so a board mounting
 * three cards at once no longer shows three identical grey boxes. And it
 * carries a delete control, because a component chunk that never resolves
 * otherwise leaves a card that can never be removed.
 *
 * The window this covers is narrower than it looks, and worth stating so the
 * next reader does not over-trust it. The host declares its remotes statically
 * in `federation({ remotes })`, so every widget's remoteEntry is initialised
 * before React's first render: a remoteEntry that hangs blanks the whole board
 * rather than reaching this card. What lands here is the later fetch of the
 * widget's own component chunk, after the board is already interactive.
 *
 * The controls are `inline`, not the board card's usual `overlay`. An overlay
 * is hover-revealed, and hover-hiding the only useful control on a card that
 * is stuck loading is exactly the trap this fixes; `inline` already means
 * "always visible, in the flow", so no new visibility rule was needed.
 */
export const WidgetLoadingCard = reatomMemo<WidgetLoadingCardProps>(({ type, onDelete }) => {
  const Icon = WIDGET_ICONS[type.icon as WidgetIconName] ?? Box

  return (
    <div className={styles.root} role="status" aria-label={`Загрузка виджета «${type.title}»`}>
      <div className={styles.head}>
        <span className={styles.title}>
          <Icon size={16} aria-hidden />
          <span className={styles.titleText}>{type.title}</span>
        </span>
        <WidgetControls placement="inline" onDelete={onDelete} />
      </div>
      <Skeleton className={styles.body} />
    </div>
  )
}, 'WidgetLoadingCard')
