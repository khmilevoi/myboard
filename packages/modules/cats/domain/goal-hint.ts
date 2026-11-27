import type { CatProfile, Weighing } from './cat'

export type GoalHintReason =
  | 'missing_weight'
  | 'missing_age'
  | 'kitten'
  | 'senior'
  | 'missing_neuter_status'
  | 'body_condition'

export type GoalHint =
  | { kind: 'available'; kcal: number; weightKg: number }
  | { kind: 'unavailable'; reason: GoalHintReason }

/**
 * A daily kcal suggestion from the resting-energy formula (70 * kg^0.75, times 1.2 for a
 * sterilized cat and 1.4 otherwise). It is a hint only: kittens, seniors and cats off the ideal
 * body condition are left to a vet. Checks run in the order of `GoalHintReason`.
 */
export function suggestGoal(input: {
  profile: CatProfile
  latest: Weighing | null
  today: Temporal.PlainDate
}): GoalHint {
  const { profile, latest, today } = input
  const unavailable = (reason: GoalHintReason): GoalHint => ({ kind: 'unavailable', reason })

  if (latest === null) return unavailable('missing_weight')
  if (profile.birthDate === null) return unavailable('missing_age')
  const birth = Temporal.PlainDate.from(profile.birthDate)
  if (Temporal.PlainDate.compare(birth, today) > 0) return unavailable('missing_age')
  const years = birth.until(today, { largestUnit: 'years' }).years
  if (years < 1) return unavailable('kitten')
  if (years > 10) return unavailable('senior')
  if (profile.sterilized === 'unknown') return unavailable('missing_neuter_status')
  if (profile.bodyCondition !== null && (profile.bodyCondition < 4 || profile.bodyCondition > 5))
    return unavailable('body_condition')

  const kcal = Math.round(70 * latest.kg ** 0.75 * (profile.sterilized === 'yes' ? 1.2 : 1.4))
  return { kind: 'available', kcal, weightKg: latest.kg }
}
