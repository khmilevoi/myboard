import { wrap } from '@reatom/core'
import { formatDecimalRu, MONTHS_SHORT } from '@shared/format/ru'
import { Plus } from 'lucide-react'
import { formatGrams, formatKg } from 'module-cats/format'
import { MemberAvatar } from 'module-cats/ui/MemberAvatar'
import { WeighDialog } from 'module-cats/ui/WeighDialog'
import { useState } from 'react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import { LineChart } from 'widget-sdk/ui/LineChart'
import { ToggleGroup, ToggleGroupItem } from 'widget-sdk/ui/toggle-group'

import type { WeightRange } from '@/model/weight-history'

import { useCats } from '../cats-context'
import { WeightTrend } from './CatWeight'

import styles from './WeightTab.module.css'

const RANGES: { value: WeightRange; label: string }[] = [
  { value: 'month', label: 'Месяц' },
  { value: 'quarter', label: '3 месяца' },
  { value: 'year', label: 'Год' },
]

/** "21 ноя". */
function shortDate(iso: string): string {
  const date = Temporal.PlainDate.from(iso)
  return `${date.day} ${MONTHS_SHORT[date.month - 1]}`
}

/**
 * `CatsLarge` WEIGHT: the chart of the chosen range beside "Взвесить" and the list of every
 * weighing. A weighing written here or by the "Вес" button of a food card is the same history.
 */
export const WeightTab = reatomMemo(() => {
  const { card } = useCats()
  // Per mount: the board tile and the fullscreen mount must not both open the dialog.
  const [weighOpen, setWeighOpen] = useState(false)
  const passport = card.view.passport()
  if (passport === null) return null

  const history = card.weightHistory
  const rows = history.rows()
  const range = history.range()
  const points = history.points()
  const axis = history.axis()
  const latest = card.view.weight()

  const weigh = (
    <>
      <button type="button" className={styles.primary} onClick={wrap(() => setWeighOpen(true))}>
        <Plus aria-hidden />
        Взвесить
      </button>
      <WeighDialog
        form={card.weighForm}
        name={passport.name}
        open={weighOpen}
        onOpenChange={setWeighOpen}
      />
    </>
  )

  if (rows.length === 0 || latest === null) {
    return (
      <section className={styles.empty} aria-label="Вес">
        <p className={styles.emptyText}>Взвешиваний пока нет</p>
        {weigh}
      </section>
    )
  }

  const middleKg = (axis.minKg + axis.maxKg) / 2
  const summary =
    latest.trend30 === null
      ? formatKg(latest.kg)
      : `${formatKg(latest.kg)}, ${formatGrams(latest.trend30)} за месяц`

  return (
    <section className={styles.root} aria-label="Вес">
      <div className={styles.chartBox}>
        <div className={styles.chartHead}>
          <span className={styles.label}>Вес</span>
          <ToggleGroup
            type="multiple"
            className={styles.seg}
            aria-label="Период"
            value={[range]}
            onValueChange={wrap((next: string[]) => {
              // Pressing the chosen range gives an empty list: keep it chosen.
              const chosen = next.find((value) => value !== range)
              if (chosen !== undefined) history.range.set(chosen as WeightRange)
            })}
          >
            {RANGES.map(({ value, label }) => (
              <ToggleGroupItem key={value} value={value} className={styles.segItem}>
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <p className={styles.figure}>
          <span className={styles.kg}>{formatDecimalRu(latest.kg, 2)}</span>
          <span className={styles.unit}>кг · {shortDate(rows[0].at)}</span>
          {latest.trend30 !== null && <WeightTrend grams={latest.trend30} suffix=" за месяц" />}
        </p>
        {points.length > 0 && (
          <LineChart
            variant="full"
            className={styles.chart}
            points={points.map(({ at, kg }) => ({ x: at, y: kg }))}
            yLabels={[axis.maxKg, middleKg, axis.minKg].map((kg) => formatDecimalRu(kg, 2))}
            xLabels={axis.months}
            summary={summary}
          />
        )}
      </div>
      <div className={styles.side}>
        {weigh}
        <ul className={styles.list} aria-label="Все взвешивания">
          {rows.map((row) => (
            <li key={row.id} className={styles.row}>
              <span className={styles.date}>{shortDate(row.at)}</span>
              <b className={styles.value}>{formatDecimalRu(row.kg, 2)}</b>
              <span
                className={styles.delta}
                data-direction={
                  row.deltaGrams === null ? undefined : row.deltaGrams < 0 ? 'down' : 'up'
                }
              >
                {row.deltaGrams === null ? '' : formatGrams(row.deltaGrams)}
              </span>
              <MemberAvatar author={row.author} px={20} />
            </li>
          ))}
        </ul>
        <p className={styles.footer}>
          Взвешивания пишутся и отсюда, и кнопкой «Вес» в питании — это одна история.
        </p>
      </div>
    </section>
  )
}, 'CatsWeightTab')
