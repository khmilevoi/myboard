import { foldDebt } from './debt'
import { resolveDays, type LedgerEntry } from './ledger'
import { DUTY_ROTATION, type Person } from './roster'

/** How many days, today included, the member statistics look back over. */
export const STATS_WINDOW_DAYS = 30

export type OfeliaMemberStats = { person: Person; cleanings: number; debt: number }

export type MemberStatsInput = {
  entries: LedgerEntry[]
  today: Temporal.PlainDate
  windowDays: number
}

/**
 * One row per rotation member, in rotation order. `cleanings` counts the days in
 * `[today − (windowDays − 1), today]` whose live outcome is a closed `cleaned`
 * day with that member as the actor; `debt` is the member's current balance.
 */
export function memberStats({ entries, today, windowDays }: MemberStatsInput): OfeliaMemberStats[] {
  const windowStart = today.subtract({ days: windowDays - 1 })
  const cleanings = new Map<Person, number>()

  for (const [iso, resolution] of resolveDays(entries)) {
    if (resolution.status !== 'closed' || resolution.type !== 'cleaned') continue
    const date = Temporal.PlainDate.from(iso)
    if (Temporal.PlainDate.compare(date, windowStart) < 0) continue
    if (Temporal.PlainDate.compare(date, today) > 0) continue
    cleanings.set(resolution.actor, (cleanings.get(resolution.actor) ?? 0) + 1)
  }

  const debts = foldDebt(entries)
  return DUTY_ROTATION.map((person) => ({
    person,
    cleanings: cleanings.get(person) ?? 0,
    debt: debts[person] ?? 0,
  }))
}
