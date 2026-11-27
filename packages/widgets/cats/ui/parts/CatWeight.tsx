import { formatDecimalRu } from '@shared/format/ru'
import { formatGrams, formatKg } from 'module-cats/format'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import { LineChart } from 'widget-sdk/ui/LineChart'

import { useCats } from '../cats-context'

import styles from './CatWeight.module.css'

export type KgFigureProps = {
  kg: number
  /** `tiny` 20 px, `compact` 30 px, `standard` 36 px (page 10). */
  size: 'tiny' | 'compact' | 'standard'
  testId?: string
}

/** "4,32 кг" with the figure large and the unit small, reading as one phrase. */
export const KgFigure = reatomMemo<KgFigureProps>(
  ({ kg, size, testId }) => (
    <span className={styles.figure} data-size={size} data-testid={testId}>
      <span className={styles.value}>{formatDecimalRu(kg, 2)}</span>{' '}
      <span className={styles.unit}>кг</span>
    </span>
  ),
  'KgFigure',
)

export type WeightTrendProps = {
  grams: number
  /** "/мес" in compact, " за месяц" in standard. */
  suffix: string
}

/**
 * "−80 г за месяц". A loss is drawn in the success colour and a gain in the secondary text
 * colour, as page 10 draws them (states A and B).
 */
export const WeightTrend = reatomMemo<WeightTrendProps>(
  ({ grams, suffix }) => (
    <span className={styles.trend} data-direction={grams < 0 ? 'down' : 'up'}>
      {`${formatGrams(grams)}${suffix}`}
    </span>
  ),
  'WeightTrend',
)

export type WeightSparkProps = {
  /** Month ticks under the line: the standard tier draws them, compact has no room. */
  labels: boolean
  className?: string
}

/** The last three months of weighings as a sparkline; nothing with no weighing in that time. */
export const WeightSpark = reatomMemo<WeightSparkProps>(({ labels, className }) => {
  const { card } = useCats()
  const points = card.view.spark()
  const first = points[0]
  const last = points.at(-1)
  if (first === undefined || last === undefined) return null
  const xLabels = labels ? card.view.sparkLabels() : []

  return (
    <LineChart
      variant="spark"
      className={className}
      points={points.map(({ at, kg }) => ({ x: at, y: kg }))}
      yLabels={[]}
      xLabels={xLabels}
      summary={`Вес за 3 месяца: с ${formatDecimalRu(first.kg, 2)} до ${formatKg(last.kg)}`}
    />
  )
}, 'WeightSpark')
