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

export function foldDebt(entries: LedgerEntry[]): NumberOfDebts {
  const debt: Partial<NumberOfDebts> = {}

  for (const entry of latestOutcomesByDate(entries).values()) {
    if (entry.type === 'went_into_debt' && entry.onBehalfOf) {
      debt[entry.onBehalfOf] = (debt[entry.onBehalfOf] ?? 0) + 1
    } else if (entry.type === 'cleaned' && entry.onBehalfOf) {
      debt[entry.actor] = (debt[entry.actor] ?? 0) - 1
    } else if (entry.type === 'forgiven' && entry.onBehalfOf) {
      debt[entry.onBehalfOf] = (debt[entry.onBehalfOf] ?? 0) - 1
    }
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
