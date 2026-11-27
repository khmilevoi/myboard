import { atom, computed } from '@reatom/core'
import type { Atom, AtomLike, Computed } from '@reatom/core'
import { MONTHS_SHORT } from '@shared/format/ru'
import type { CatModel } from 'module-cats'
import { resolveEntryAuthor, type EntryAuthor, type MemberLookup } from 'module-cats/domain/author'

/** How far back the chart looks: 30, 90 or 365 days from today. */
export type WeightRange = 'month' | 'quarter' | 'year'

export const WEIGHT_RANGE_DAYS: Record<WeightRange, number> = {
  month: 30,
  quarter: 90,
  year: 365,
}

export type WeightPoint = { at: string; kg: number }

export type WeightAxis = {
  minKg: number
  maxKg: number
  /** The month starts inside the range ("1 СЕН") and the latest day ("21 НОЯ"). */
  months: { at: string; label: string }[]
}

export type WeightRow = {
  id: string
  at: string
  kg: number
  /** Grams against the next older weighing; null for the oldest. */
  deltaGrams: number | null
  author: EntryAuthor
}

export type WeightHistory = {
  range: Atom<WeightRange>
  points: Computed<WeightPoint[]>
  axis: Computed<WeightAxis>
  rows: Computed<WeightRow[]>
}

/** Room above and below the line, in kg. */
const AXIS_PADDING_KG = 0.05

/** The most x labels the axis draws before it thins its month starts. */
const MAX_MONTH_LABELS = 7

const round2 = (value: number) => Math.round(value * 100) / 100

const dayLabel = (date: Temporal.PlainDate) =>
  `${date.day} ${MONTHS_SHORT[date.month - 1].toUpperCase()}`

/**
 * The "Вес" tab's model: the weighings inside a range for the chart, and every weighing as a list
 * row. A range excludes its first day (`at > today - N days`): "30 days" shows the last 30 days,
 * not 31 of them.
 */
export function makeWeightHistory(
  cat: AtomLike<CatModel | null>,
  today: AtomLike<Temporal.PlainDate | null>,
  members: AtomLike<MemberLookup>,
  name = 'weightHistory',
): WeightHistory {
  const range = atom<WeightRange>('quarter', `${name}.range`)

  // Oldest first; weighings of one day in the order they were written.
  const sorted = computed(
    () =>
      (cat()?.weighings() ?? []).toSorted((a, b) =>
        a.at === b.at ? a.ts - b.ts : a.at < b.at ? -1 : 1,
      ),
    `${name}.sorted`,
  )

  const points = computed((): WeightPoint[] => {
    const day = today()
    if (day === null) return []
    const from = day.subtract({ days: WEIGHT_RANGE_DAYS[range()] }).toString()
    return sorted()
      .filter((weighing) => weighing.at > from)
      .map(({ at, kg }) => ({ at, kg }))
  }, `${name}.points`)

  const axis = computed((): WeightAxis => {
    const list = points()
    const first = list[0]
    const last = list.at(-1)
    if (first === undefined || last === undefined) return { minKg: 0, maxKg: 0, months: [] }
    const kgs = list.map((point) => point.kg)
    const lastDay = Temporal.PlainDate.from(last.at)
    const starts: WeightAxis['months'] = []
    for (
      let month = Temporal.PlainDate.from(first.at).toPlainYearMonth();
      Temporal.PlainYearMonth.compare(month, lastDay.toPlainYearMonth()) <= 0;
      month = month.add({ months: 1 })
    ) {
      const start = month.toPlainDate({ day: 1 })
      // The latest day closes the axis; a month starting on it would label it twice.
      if (start.toString() === last.at) continue
      starts.push({ at: start.toString(), label: dayLabel(start) })
    }
    // A year has up to 13 labels, which overlap at phone width: past `MAX_MONTH_LABELS`, every
    // second month start is kept. The latest day always closes the axis.
    const shown =
      starts.length + 1 > MAX_MONTH_LABELS ? starts.filter((_, index) => index % 2 === 0) : starts
    const months = [...shown, { at: last.at, label: dayLabel(lastDay) }]
    return {
      minKg: round2(Math.min(...kgs) - AXIS_PADDING_KG),
      maxKg: round2(Math.max(...kgs) + AXIS_PADDING_KG),
      months,
    }
  }, `${name}.axis`)

  const rows = computed((): WeightRow[] => {
    const list = sorted()
    const lookup = members()
    return list
      .map((weighing, index): WeightRow => {
        const older = list[index - 1]
        return {
          id: weighing.id,
          at: weighing.at,
          kg: weighing.kg,
          deltaGrams: older === undefined ? null : Math.round((weighing.kg - older.kg) * 1000),
          author: resolveEntryAuthor(weighing.createdBy, undefined, lookup),
        }
      })
      .reverse()
  }, `${name}.rows`)

  return { range, points, axis, rows }
}
