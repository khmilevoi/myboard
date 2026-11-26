import { foldDebt } from './debt'
import { resolveDays, type LedgerEntry } from './ledger'
import { DUTY_ROTATION, type Person } from './roster'

/** How many days, today included, the member statistics look back over. */
export const STATS_WINDOW_DAYS = 30

export type LitterMemberStats = { person: Person; cleanings: number; debt: number }

export type MemberStatsInput = {
  entries: LedgerEntry[]
  today: Temporal.PlainDate
  windowDays: number
}

/**
 * One row per rotation member, in rotation order. `debt` is the member's current balance.
 *
 * `cleanings` counts the days in `[today − (windowDays − 1), today]` that member physically
 * cleaned: every day whose live outcome is closed, credited to the outcome's `actor`. Each closed
 * outcome type names the person who actually cleaned (see drafts.ts):
 * - `cleaned` — the duty person, or the debtor repaying on a debt day;
 * - `went_into_debt` — the other member, who covered the scheduled person's day;
 * - `forgiven` — the day's own duty person, who cleaned it and waived the debtor's repayment.
 * A `reset` reopens the day (status `pending`), so an undone day counts for nobody.
 */
export function memberStats({ entries, today, windowDays }: MemberStatsInput): LitterMemberStats[] {
  const windowStart = today.subtract({ days: windowDays - 1 })
  const cleanings = new Map<Person, number>()

  for (const [iso, resolution] of resolveDays(entries)) {
    if (resolution.status !== 'closed') continue
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
