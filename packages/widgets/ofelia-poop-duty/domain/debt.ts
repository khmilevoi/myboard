import { z } from 'zod'

import { latestOutcomesByDate } from './ledger'
import type { DayResolution, LedgerEntry } from './ledger'
import { DUTY_ROTATION, getOfeliaDutyByDate } from './roster'
import type { DutyPerson, Person } from './roster'

export const DEBT_WARNING_THRESHOLD = 7

// z.object with explicit keys (vs z.record) enables .partial(), which tolerates
// legacy/partial storage records where some rotation keys may be absent.
export const NumberOfDebtsSchema = z
  .object({
    // Keep in sync with DUTY_ROTATION tuple.
    Леша: z.int().nonnegative(),
    Карина: z.int().nonnegative(),
  })
  .partial()
export type NumberOfDebts = z.infer<typeof NumberOfDebtsSchema>

export type DebtDay = {
  date: Temporal.PlainDate
  person: DutyPerson
}

export type DebtDelta = { person: Person; amount: 1 | -1 }

/**
 * How one day's outcome moves the balance, or null when it leaves it alone.
 * The single source of truth for both the running total (`foldDebt`) and the
 * per-entry badge the history list renders — the two used to carry separate
 * copies of these branches and could drift apart.
 */
export function debtDeltaFor(entry: LedgerEntry): DebtDelta | null {
  if (!entry.onBehalfOf) return null

  if (entry.type === 'went_into_debt') {
    // Charge a missed turn only when the day was the debtor's own. A debt day
    // is a *repayment* slot carved out of the creditor's rotation day — they
    // were cleaning it either way, so a repayment that fails to happen leaves
    // the balance untouched rather than billing the same absence twice.
    //
    // Without this the debt compounds: every unpaid repayment day mints a
    // fresh debt day, which mints another, so a single missed turn grows
    // without bound while the debtor is away. Production reached six days
    // against four real misses this way.
    return getOfeliaDutyByDate(Temporal.PlainDate.from(entry.date)) === entry.onBehalfOf
      ? { person: entry.onBehalfOf, amount: 1 }
      : null
  }

  // Cleaning a day that wasn't yours repays you — `cleaned` only ever carries
  // `onBehalfOf` on a debt day, so it is already scoped to that case.
  if (entry.type === 'cleaned') return { person: entry.actor, amount: -1 }
  // Forgiveness is an explicit manual waiver: it applies wherever recorded.
  if (entry.type === 'forgiven') return { person: entry.onBehalfOf, amount: -1 }

  return null
}

export function foldDebt(entries: LedgerEntry[]): NumberOfDebts {
  const debt: Partial<NumberOfDebts> = {}

  for (const entry of latestOutcomesByDate(entries).values()) {
    const delta = debtDeltaFor(entry)
    if (delta) debt[delta.person] = (debt[delta.person] ?? 0) + delta.amount
  }

  return normalizeDebts(debt)
}

export function normalizeDebts(debts: Partial<NumberOfDebts>): NumberOfDebts {
  const values = DUTY_ROTATION.map((person) => debts[person] ?? 0)

  const minDebt = Math.min(...values)

  return DUTY_ROTATION.reduce<NumberOfDebts>(
    (normalized, person) => ({
      ...normalized,
      [person]: (debts[person] ?? 0) - minDebt,
    }),
    {} as NumberOfDebts,
  )
}

export function getDebtDays(
  debts: Partial<NumberOfDebts>,
  startDate: Temporal.PlainDate,
  resolution: ReadonlyMap<string, DayResolution> = new Map(),
): DebtDay[] {
  if (DUTY_ROTATION.length < 2) {
    return []
  }

  const days: DebtDay[] = []
  let currentDate = startDate

  for (const person of DUTY_ROTATION) {
    let remainingDebt = debts[person] ?? 0

    while (remainingDebt > 0) {
      const plannedDuty = getOfeliaDutyByDate(currentDate)
      const isClosed = resolution.get(currentDate.toString())?.status === 'closed'

      if (plannedDuty !== person && !isClosed) {
        days.push({
          date: currentDate,
          person,
        })

        remainingDebt -= 1
      }

      currentDate = currentDate.add({ days: 1 })
    }
  }

  return days
}

export function effectiveDuty(
  date: Temporal.PlainDate,
  debts: Partial<NumberOfDebts>,
  today: Temporal.PlainDate,
  resolution?: ReadonlyMap<string, DayResolution>,
): Person {
  const debtDay = getDebtDays(debts, today, resolution).find((day) => day.date.equals(date))
  return debtDay?.person ?? getOfeliaDutyByDate(date)
}

export function isDebtDay(
  date: Temporal.PlainDate,
  debts: Partial<NumberOfDebts>,
  today: Temporal.PlainDate,
  resolution?: ReadonlyMap<string, DayResolution>,
): boolean {
  return getDebtDays(debts, today, resolution).some((day) => day.date.equals(date))
}

export function isOverDebtWarning(debts: Partial<NumberOfDebts>, person: Person): boolean {
  return (debts[person] ?? 0) > DEBT_WARNING_THRESHOLD
}
