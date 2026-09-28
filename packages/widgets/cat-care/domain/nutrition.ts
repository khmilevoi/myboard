import { MAX_CAT_WEIGHT_KG, type CatProfile, type FoodRecord, type WeightRecord } from './schemas'
import { getLocalDate, MAX_FUTURE_SKEW_MS } from './time'

export const CAT_CARE_SOURCES = [
  {
    title: 'Калорийность и потребности — Merck Veterinary Manual',
    url: 'https://www.merckvetmanual.com/management-and-nutrition/nutrition-small-animals/nutritional-requirements-of-small-animals',
  },
  {
    title: 'Питание и контроль веса — AAHA',
    url: 'https://www.aaha.org/resources/2021-aaha-nutrition-and-weight-management-guidelines/feeding-plans-for-healthy-appropriate-weight-cats-and-dogs/',
  },
  {
    title: 'Вода — Cornell Feline Health Center',
    url: 'https://www.vet.cornell.edu/departments-centers-and-institutes/cornell-feline-health-center/health-information/feline-health-topics/hydration',
  },
  {
    title: 'Шкала упитанности — WSAVA',
    url: 'https://wsava.org/wp-content/uploads/2020/08/Body-Condition-Score-cat-updated-August-2020.pdf',
  },
  {
    title: 'Исследование измерения воды из миски',
    url: 'https://journals.sagepub.com/doi/10.1177/1098612X18803753',
  },
] as const

export function calculateFoodNutrition(record: FoodRecord) {
  const eatenGrams =
    record.mode === 'eaten'
      ? record.grams
      : record.remainingGrams === null
        ? null
        : record.grams - record.remainingGrams
  const portionAmount = (per100: number | null) => {
    if (eatenGrams === 0) return 0
    if (eatenGrams === null || per100 === null) return null
    return (eatenGrams * per100) / 100
  }
  const nutrition = record.snapshot.nutrition
  const offeredKcal = (record.grams * nutrition.kcalPer100g) / 100
  return {
    eatenGrams,
    eatenKcal: portionAmount(nutrition.kcalPer100g),
    offeredKcal,
    pendingKcal: eatenGrams === null ? offeredKcal : 0,
    proteinGrams: portionAmount(nutrition.proteinPer100g),
    fatGrams: portionAmount(nutrition.fatPer100g),
    carbsGrams: portionAmount(nutrition.carbsPer100g),
    foodWaterMl: portionAmount(nutrition.moisturePercent),
  }
}

export type EnergyEstimate = {
  kcal: number | null
  weightKg: number | null
  reason:
    | 'available'
    | 'missing_weight'
    | 'missing_age'
    | 'missing_neuter_status'
    | 'kitten'
    | 'senior'
    | 'body_condition'
}

export function estimateCalorieTarget({
  profile,
  latestWeight,
  nowMs,
}: {
  profile: CatProfile
  latestWeight: WeightRecord | null
  nowMs: number
}): EnergyEstimate {
  const weightKg =
    latestWeight !== null &&
    latestWeight.occurredAt <= nowMs + MAX_FUTURE_SKEW_MS &&
    latestWeight.kilograms > 0 &&
    latestWeight.kilograms <= MAX_CAT_WEIGHT_KG &&
    Number.isFinite(latestWeight.kilograms)
      ? latestWeight.kilograms
      : null
  const unavailable = (reason: EnergyEstimate['reason']): EnergyEstimate => ({
    kcal: null,
    weightKg,
    reason,
  })
  // Missing or unusable input needs a valid measurement before calculation.
  if (weightKg === null) return unavailable('missing_weight')
  if (profile.birthDate === null) return unavailable('missing_age')
  const today = Temporal.PlainDate.from(
    getLocalDate({ occurredAt: nowMs, timeZone: profile.timeZone }),
  )
  const birth = Temporal.PlainDate.from(profile.birthDate)
  if (Temporal.PlainDate.compare(birth, today) > 0) return unavailable('missing_age')
  const years = birth.until(today, { largestUnit: 'years' }).years
  if (years < 1) return unavailable('kitten')
  if (years > 10) return unavailable('senior')
  if (profile.neutered === null) return unavailable('missing_neuter_status')
  if (
    profile.bodyConditionScore !== null &&
    (profile.bodyConditionScore < 4 || profile.bodyConditionScore > 5)
  )
    return unavailable('body_condition')
  const kcal = Math.round(70 * weightKg ** 0.75 * (profile.neutered ? 1.2 : 1.4))
  return { kcal, weightKg, reason: 'available' }
}
