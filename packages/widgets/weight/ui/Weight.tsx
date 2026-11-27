import { wrap } from '@reatom/core'
import { Weight as WeightIcon } from 'lucide-react'
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { type WidgetTier, useWidgetContext } from 'widget-runtime'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import { useAtomValue } from 'widget-sdk/reatom/use-atom-value'
import { type WidgetChrome, useWidgetChrome, WidgetControls } from 'widget-sdk/ui/WidgetControls'

import {
  makeWeightView,
  type WeightCardData,
  type WeightLens,
  type WeightPeriod,
  type WeightView,
} from '../model/weight-view'
import { CompactTier } from './tiers/CompactTier'
import { LargeTier } from './tiers/LargeTier'
import { StandardTier } from './tiers/StandardTier'
import { TinyTier } from './tiers/TinyTier'

import styles from './weight.module.css'

function renderLoading(tier: WidgetTier, chrome: WidgetChrome) {
  return (
    <div className={styles.widget} data-tier={tier}>
      <WidgetControls {...chrome} />
      <div className={styles.card} aria-busy="true" aria-label="Загрузка веса">
        <div className={styles.head}>
          <span className={styles.label}>Вес</span>
          <span className={`${styles.skeleton} ${styles.skeletonDate}`} />
        </div>
        <span className={`${styles.skeleton} ${styles.skeletonValue}`} />
        <span className={`${styles.skeleton} ${styles.skeletonChart}`} />
      </div>
    </div>
  )
}

function renderMessage(tier: WidgetTier, chrome: WidgetChrome, body: ReactNode) {
  return (
    <div className={styles.widget} data-tier={tier}>
      <WidgetControls {...chrome} />
      <div className={styles.message}>{body}</div>
    </div>
  )
}

export const Weight = reatomMemo(() => {
  const { tier, modules } = useWidgetContext()
  // Hooks first: the card below returns early per state.
  const chrome = useWidgetChrome()
  const view = useMemo(() => makeWeightView(modules, Date.now), [modules])
  // The compact tier has no period control, so it reads the lens pinned to 30 days; the
  // selection itself stays as it was for when the card grows back.
  const lens = tier === 'compact' ? view.compact : view.selected

  // Keyed by lens: each lens is a different set of atoms, and a fresh mount subscribes to it
  // cleanly instead of swapping atoms under the same hooks.
  return (
    <WeightCard
      key={tier === 'compact' ? 'compact' : 'selected'}
      view={view}
      lens={lens}
      tier={tier}
      chrome={chrome}
    />
  )
}, 'Weight')

type WeightCardProps = {
  view: WeightView
  lens: WeightLens
  tier: WidgetTier
  chrome: WidgetChrome
}

const WeightCard = reatomMemo<WeightCardProps>(({ view, lens, tier, chrome }) => {
  const onRetry = useMemo(() => wrap(() => view.retry()), [view])
  const onSelectPeriod = useMemo(
    () => wrap((period: WeightPeriod) => view.setPeriod(period)),
    [view],
  )

  // Read race-free and unconditionally, so the hook set stays fixed whichever branch returns.
  const state = useAtomValue(lens.state)
  const latest = useAtomValue(view.latest)
  const period = useAtomValue(lens.period)
  const selectedPeriod = useAtomValue(view.period)
  const points = useAtomValue(lens.points)
  const delta = useAtomValue(lens.delta)
  const bounds = useAtomValue(lens.bounds)
  const rows = useAtomValue(lens.rows)
  const updating = useAtomValue(lens.updating)
  // The ticking clock, so "сегодня" turns into a date at midnight while the card stays open.
  const now = useAtomValue(view.now)

  if (state === 'loading') return renderLoading(tier, chrome)

  if (state === 'error') {
    return renderMessage(
      tier,
      chrome,
      <div role="alert" className={styles.messageInner}>
        <p className={styles.messageTitle}>Не удалось загрузить данные</p>
        <button type="button" className={styles.retry} onClick={onRetry}>
          Повторить
        </button>
      </div>,
    )
  }

  if (state === 'empty' || latest === null) {
    return renderMessage(
      tier,
      chrome,
      <div className={styles.messageInner}>
        <span className={styles.emptyIcon} aria-hidden>
          <WeightIcon />
        </span>
        <p className={styles.messageTitle}>Пока нет измерений</p>
        <p className={styles.messageText}>
          Встаньте на подключённые весы, и вес появится здесь сам.
        </p>
      </div>,
    )
  }

  const data: WeightCardData = {
    state,
    latest,
    period,
    selectedPeriod,
    points: points ?? [],
    delta,
    bounds,
    rows: rows ?? [],
    now,
  }

  let content: ReactNode = null
  switch (tier) {
    case 'tiny':
      content = <TinyTier data={data} />
      break
    case 'compact':
      content = <CompactTier data={data} />
      break
    case 'standard':
      content = <StandardTier data={data} onSelectPeriod={onSelectPeriod} />
      break
    case 'large':
    case 'fullscreen':
      content = <LargeTier data={data} chrome={chrome} onSelectPeriod={onSelectPeriod} />
      break
  }

  const large = tier === 'large' || tier === 'fullscreen'
  return (
    <div
      className={styles.widget}
      data-tier={tier satisfies WidgetTier}
      // A newly chosen period is loading; the previous period's readings stay meanwhile.
      aria-busy={updating || undefined}
    >
      {/* The large layout puts the controls in its own header row. */}
      {!large && <WidgetControls {...chrome} />}
      {content}
    </div>
  )
}, 'WeightCard')
