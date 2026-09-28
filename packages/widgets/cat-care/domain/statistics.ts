import { calculateFoodNutrition } from './nutrition'
import type { CalorieTarget, CatCareState, WeightRecord } from './schemas'
import { getLocalDate } from './time'

export type DaySummary = {
  date: string
  eatenKcal: number
  pendingKcal: number
  foodCount: number
  targetKcal: number | null
  proteinGrams: number | null
  fatGrams: number | null
  carbsGrams: number | null
  foodMoistureMl: number | null
  hasUnknownMacros: boolean
  pendingCount: number
  unknownMoistureCount: number
  hasEstimatedTiming: boolean
}

export function getTargetForDate({
  profileHistory,
  date,
}: {
  profileHistory: CatCareState['profileHistory']
  date: string
}): CalorieTarget | null {
  const changes = profileHistory
    .flatMap((revision, index) => {
      const target = revision.profile.calorieTarget
      const previous = profileHistory[index - 1]?.profile.calorieTarget
      // A name/age edit retaining the same target does not assign it again or
      // move the date at which an already cleared target was removed.
      if (
        index > 0 &&
        target?.kcal === previous?.kcal &&
        target?.source === previous?.source &&
        target?.effectiveFrom === previous?.effectiveFrom
      )
        return []
      return [
        {
          target,
          date:
            target?.effectiveFrom ??
            getLocalDate({ occurredAt: revision.ts, timeZone: revision.profile.timeZone }),
          index,
        },
      ]
    })
    .filter((change) => change.date <= date)
  // An explicit removal also cancels goals scheduled earlier for a future
  // date. Keep all earlier history when viewing dates before that removal.
  const removalIndex = changes.findLast((change) => change.target === null)?.index ?? -1
  const applicable = changes
    .filter((change) => change.index >= removalIndex)
    .sort((a, b) => a.date.localeCompare(b.date) || a.index - b.index)
  return applicable.at(-1)?.target ?? null
}

function sumKnown(values: (number | null)[]) {
  if (values.some((value) => value === null)) return null
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0)
}

export function summarizeDay({
  state,
  date,
  timeZone,
}: {
  state: CatCareState
  date: string
  timeZone: string
}): DaySummary {
  const records = state.foods.filter(
    (record) => getLocalDate({ occurredAt: record.occurredAt, timeZone }) === date,
  )
  const portions = records.map(calculateFoodNutrition)
  const eaten = portions.filter((portion) => portion.eatenGrams !== null)
  const proteinGrams = sumKnown(eaten.map((portion) => portion.proteinGrams))
  const fatGrams = sumKnown(eaten.map((portion) => portion.fatGrams))
  const carbsGrams = sumKnown(eaten.map((portion) => portion.carbsGrams))
  return {
    date,
    eatenKcal: eaten.reduce((sum, portion) => sum + (portion.eatenKcal ?? 0), 0),
    pendingKcal: portions.reduce((sum, portion) => sum + portion.pendingKcal, 0),
    foodCount: records.length,
    targetKcal: getTargetForDate({ profileHistory: state.profileHistory, date })?.kcal ?? null,
    proteinGrams,
    fatGrams,
    carbsGrams,
    foodMoistureMl: sumKnown(eaten.map((portion) => portion.foodWaterMl)),
    hasUnknownMacros: proteinGrams === null || fatGrams === null || carbsGrams === null,
    pendingCount: portions.length - eaten.length,
    unknownMoistureCount: eaten.filter((portion) => portion.foodWaterMl === null).length,
    hasEstimatedTiming: records.some(
      (record) =>
        record.observedAt !== null &&
        getLocalDate({ occurredAt: record.observedAt, timeZone }) !== date,
    ),
  }
}

export function summarizePeriod({
  state,
  endDate,
  days,
  timeZone,
}: {
  state: CatCareState
  endDate: string
  days: number
  timeZone: string
}) {
  const end = Temporal.PlainDate.from(endDate)
  const summaries = Array.from({ length: days }, (_, index) =>
    summarizeDay({ state, date: end.subtract({ days: days - index - 1 }).toString(), timeZone }),
  )
  const logged = summaries.filter((day) => day.foodCount > 0)
  const confirmed = logged.filter((day) => day.foodCount > day.pendingCount)
  return {
    days: summaries,
    loggedDays: logged.length,
    confirmedDays: confirmed.length,
    averageEatenKcal:
      confirmed.length === 0
        ? null
        : confirmed.reduce((sum, day) => sum + day.eatenKcal, 0) / confirmed.length,
  }
}

export function getWeightSeries({
  records,
  fromMs,
  toMs,
}: {
  records: WeightRecord[]
  fromMs?: number
  toMs?: number
}) {
  return records
    .filter(
      (record) =>
        (fromMs === undefined || record.occurredAt >= fromMs) &&
        (toMs === undefined || record.occurredAt <= toMs),
    )
    .sort((a, b) => a.occurredAt - b.occurredAt)
}
